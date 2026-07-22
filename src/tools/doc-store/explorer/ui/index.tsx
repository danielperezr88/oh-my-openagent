import React from "react"
import { createRoot } from "react-dom/client"
import DocStoreExplorer from "./App"
import type { ExplorerData } from "../generate-data"

const App: React.FC = () => {
  const [data, setData] = React.useState<ExplorerData | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    fetch("/api/data")
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  if (error) {
    return (
      <div style={{ padding: 40, color: "#ef4444", fontFamily: "monospace" }}>
        Failed to load explorer data: {error}
      </div>
    )
  }

  if (!data) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "#0a0a0f",
        color: "#8888a0",
        fontFamily: "sans-serif",
        fontSize: 16,
      }}>
        Loading doc-store explorer...
      </div>
    )
  }

  return <DocStoreExplorer data={data} />
}

const root = createRoot(document.getElementById("root")!)
root.render(<App />)
