import { useRef, useState } from "react";
import { uploadDatasets, UploadResult } from "../api";

export function UploadPanel({ onUploaded }: { onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [dragActive, setDragActive] = useState(false);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).filter((f) => /\.(xlsx|xls)$/i.test(f.name));
    if (files.length === 0) return;

    setPending(true);
    setResults([]);
    try {
      const res = await uploadDatasets(files);
      setResults(res);
      onUploaded();
    } catch (err) {
      setResults([{ fileName: "batch", error: err instanceof Error ? err.message : "Upload failed" }]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className={`upload-panel ${dragActive ? "drag-active" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <p className="upload-title">Drop Excel files here or</p>
      <button onClick={() => inputRef.current?.click()} disabled={pending}>
        {pending ? "Uploading..." : "Choose files"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        multiple
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />

      {results.length > 0 && (
        <ul className="upload-results">
          {results.map((r, i) => (
            <li key={i} className={r.error ? "error" : "success"}>
              {r.fileName} — {r.error ? `Error: ${r.error}` : "Ingested"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
