import { lazy, Suspense } from "react";

const MonacoDiffEditor = lazy(() =>
  import("@monaco-editor/react").then((mod) => ({
    default: mod.DiffEditor,
  }))
);

interface Props {
  original: string;
  modified: string;
  language: string;
  fileName?: string;
}

export default function DiffViewer({ original, modified, language }: Props) {
  return (
    <Suspense
      fallback={
        <div className="w-full h-full flex items-center justify-center">
          <span className="text-xs text-text-muted">Loading editor...</span>
        </div>
      }
    >
      <MonacoDiffEditor
        original={original}
        modified={modified}
        language={language}
        theme="vs-dark"
        options={{
          readOnly: true,
          renderSideBySide: false,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
          lineHeight: 18,
          padding: { top: 8, bottom: 8 },
          renderOverviewRuler: false,
          overviewRulerBorder: false,
          scrollbar: {
            verticalScrollbarSize: 6,
            horizontalScrollbarSize: 6,
          },
          lineNumbers: "on",
          glyphMargin: false,
          folding: false,
          lineDecorationsWidth: 0,
          lineNumbersMinChars: 3,
        }}
      />
    </Suspense>
  );
}
