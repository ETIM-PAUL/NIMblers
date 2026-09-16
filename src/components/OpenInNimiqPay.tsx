interface Props {
  errorMessage: string | null
}

export function OpenInNimiqPay({ errorMessage }: Props) {
  return (
    <div className="fallback-screen">
      <h1 className="fallback-title">Open me inside Nimiq Pay</h1>
      <p className="fallback-body">This app runs inside Nimiq Pay.</p>
      <ol className="fallback-steps">
        <li>Open the Nimiq Pay app on your phone</li>
        <li>Go to Mini Apps</li>
        <li>Enter this app's URL</li>
      </ol>
      {errorMessage && <p className="fallback-error">Connection error: {errorMessage}</p>}
    </div>
  )
}
