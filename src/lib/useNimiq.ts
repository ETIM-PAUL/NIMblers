import { init } from '@nimiq/mini-app-sdk'
import { useCallback, useEffect, useRef, useState } from 'react'

type NimiqClient = Awaited<ReturnType<typeof init>>

interface NimiqConnection {
  isConnecting: boolean
  isReady: boolean
  errorMessage: string | null
  hasConsensus: boolean | null
  address: string | null
  isLoadingAddress: boolean
  addressError: string | null
  connectWallet: () => Promise<void>
  /** Sends a basic NIM payment (in Luna) through the user's own wallet, returning the tx hash. Requires a native confirmation dialog; throws on rejection or error. */
  sendPayment: (recipient: string, valueLuna: number) => Promise<string>
}

// Initializes the Nimiq provider once and reports connection state.
// The app must stay usable when opened outside Nimiq Pay (e.g. a regular browser),
// so a failed/missing connection is surfaced as state, never thrown.
//
// listAccounts() requires a native approval dialog, so it is never called on
// mount — only from connectWallet(), triggered by a user tap.
export function useNimiq(): NimiqConnection {
  const clientRef = useRef<NimiqClient | null>(null)
  const [isConnecting, setIsConnecting] = useState(true)
  const [isReady, setIsReady] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [hasConsensus, setHasConsensus] = useState<boolean | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [isLoadingAddress, setIsLoadingAddress] = useState(false)
  const [addressError, setAddressError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    init({ timeout: 10_000 })
      .then(async (nimiq) => {
        clientRef.current = nimiq
        setIsReady(true)
        // Step 5 sanity check: a no-confirmation read call to confirm the
        // connection works end to end, per the mini-apps skill scaffold guide.
        try {
          setHasConsensus(await nimiq.isConsensusEstablished())
        }
        catch {
          setHasConsensus(null)
        }
      })
      .catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        setIsConnecting(false)
      })
  }, [])

  const connectWallet = useCallback(async () => {
    const client = clientRef.current
    if (!client) return
    setIsLoadingAddress(true)
    setAddressError(null)
    try {
      const result = await client.listAccounts()
      if ('error' in result) {
        setAddressError(result.error.message)
      }
      else {
        setAddress(result[0] ?? null)
      }
    }
    catch (error) {
      setAddressError(error instanceof Error ? error.message : String(error))
    }
    finally {
      setIsLoadingAddress(false)
    }
  }, [])

  // Generous — this is real user think time (reviewing and tapping to
  // confirm a real payment), not a network round trip — but still bounded,
  // so a request that never gets a response (the provider bridge silently
  // dropping it, no confirmation sheet ever appearing) eventually surfaces
  // as a clear error instead of leaving the UI stuck on "Confirm the
  // payment…" forever with no feedback.
  const PAYMENT_TIMEOUT_MS = 120_000

  const sendPayment = useCallback(async (recipient: string, valueLuna: number): Promise<string> => {
    const client = clientRef.current
    if (!client) throw new Error('Nimiq provider is not ready')
    const result = await Promise.race([
      client.sendBasicTransaction({ recipient, value: valueLuna }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Timed out waiting for the payment to be confirmed in Nimiq Pay')), PAYMENT_TIMEOUT_MS)
      }),
    ])
    if (typeof result === 'string') return result
    throw new Error(result?.error?.message ?? 'Payment failed with no error message from the provider')
  }, [])

  return {
    isConnecting,
    isReady,
    errorMessage,
    hasConsensus,
    address,
    isLoadingAddress,
    addressError,
    connectWallet,
    sendPayment,
  }
}
