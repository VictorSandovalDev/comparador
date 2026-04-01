"use client";

import { useState, useCallback, useRef } from "react";
import * as Diff from "diff";
import mammoth from "mammoth";

type DiffBlock = {
  type: "added" | "removed" | "unchanged" | "modified";
  oldLines: string[];
  newLines: string[];
  oldStartLine: number;
  newStartLine: number;
  wordDiffs?: WordDiff[][];
};

type WordDiff = {
  value: string;
  added?: boolean;
  removed?: boolean;
};

type FileInfo = {
  name: string;
  text: string;
};

type Stats = {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
};

type FilterType = "all" | "added" | "removed" | "modified";

export default function Home() {
  const [oldFile, setOldFile] = useState<FileInfo | null>(null);
  const [newFile, setNewFile] = useState<FileInfo | null>(null);
  const [diffBlocks, setDiffBlocks] = useState<DiffBlock[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [dragOver, setDragOver] = useState<"old" | "new" | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(true);

  const oldInputRef = useRef<HTMLInputElement>(null);
  const newInputRef = useRef<HTMLInputElement>(null);

  const parseFile = async (file: File): Promise<FileInfo> => {
    const fileName = file.name.toLowerCase();
    const arrayBuffer = await file.arrayBuffer();

    let text = "";

    if (fileName.endsWith(".docx") || fileName.endsWith(".doc")) {
      const result = await mammoth.extractRawText({ arrayBuffer });
      text = result.value;
    } else if (fileName.endsWith(".pdf")) {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pageText = content.items.map((item: any) => item.str || "").join(" ");
        pages.push(pageText);
      }
      text = pages.join("\n\n");
    } else if (fileName.endsWith(".txt")) {
      text = await file.text();
    } else {
      throw new Error("Formato no soportado. Use .docx, .pdf o .txt");
    }

    return { name: file.name, text };
  };

  const handleFile = async (file: File, setter: (f: FileInfo) => void) => {
    setError(null);
    try {
      const info = await parseFile(file);
      setter(info);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    }
  };

  const handleDrop = useCallback(
    (e: React.DragEvent, target: "old" | "new") => {
      e.preventDefault();
      setDragOver(null);
      const file = e.dataTransfer.files[0];
      if (file) {
        handleFile(file, target === "old" ? setOldFile : setNewFile);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const computeDiff = useCallback(() => {
    if (!oldFile || !newFile) return;
    setLoading(true);
    setError(null);

    setTimeout(() => {
      try {
        const oldLines = oldFile.text.split("\n");
        const newLines = newFile.text.split("\n");
        const changes = Diff.diffArrays(oldLines, newLines);

        const blocks: DiffBlock[] = [];
        let oldLineNum = 1;
        let newLineNum = 1;
        const statsCount: Stats = { added: 0, removed: 0, modified: 0, unchanged: 0 };

        let i = 0;
        while (i < changes.length) {
          const change = changes[i];

          if (change.removed && i + 1 < changes.length && changes[i + 1].added) {
            const removedLines = change.value;
            const addedLines = changes[i + 1].value;

            const wordDiffs: WordDiff[][] = [];
            const maxLen = Math.min(removedLines.length, addedLines.length);
            for (let j = 0; j < maxLen; j++) {
              wordDiffs.push(
                Diff.diffWords(removedLines[j], addedLines[j]).map((d) => ({
                  value: d.value,
                  added: d.added,
                  removed: d.removed,
                }))
              );
            }

            blocks.push({
              type: "modified",
              oldLines: removedLines,
              newLines: addedLines,
              oldStartLine: oldLineNum,
              newStartLine: newLineNum,
              wordDiffs,
            });
            statsCount.modified += maxLen;
            // Extra lines beyond the paired ones count as added/removed
            if (removedLines.length > addedLines.length) {
              statsCount.removed += removedLines.length - addedLines.length;
            } else if (addedLines.length > removedLines.length) {
              statsCount.added += addedLines.length - removedLines.length;
            }

            oldLineNum += removedLines.length;
            newLineNum += addedLines.length;
            i += 2;
          } else if (change.removed) {
            blocks.push({
              type: "removed",
              oldLines: change.value,
              newLines: [],
              oldStartLine: oldLineNum,
              newStartLine: newLineNum,
            });
            statsCount.removed += change.value.length;
            oldLineNum += change.value.length;
            i++;
          } else if (change.added) {
            blocks.push({
              type: "added",
              oldLines: [],
              newLines: change.value,
              oldStartLine: oldLineNum,
              newStartLine: newLineNum,
            });
            statsCount.added += change.value.length;
            newLineNum += change.value.length;
            i++;
          } else {
            blocks.push({
              type: "unchanged",
              oldLines: change.value,
              newLines: change.value,
              oldStartLine: oldLineNum,
              newStartLine: newLineNum,
            });
            statsCount.unchanged += change.value.length;
            oldLineNum += change.value.length;
            newLineNum += change.value.length;
            i++;
          }
        }

        setDiffBlocks(blocks);
        setStats(statsCount);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al comparar archivos");
      } finally {
        setLoading(false);
      }
    }, 50);
  }, [oldFile, newFile]);

  const filteredBlocks = diffBlocks.filter((b) => {
    if (filter === "all") return showUnchanged || b.type !== "unchanged";
    return b.type === filter;
  });

  const renderWordDiffOld = (wordDiff: WordDiff[]) =>
    wordDiff.map((part, i) => {
      if (part.added) return null;
      if (part.removed) {
        return (
          <span key={i} className="bg-red-300 text-red-900 px-0.5 rounded font-semibold line-through decoration-red-600">
            {part.value}
          </span>
        );
      }
      return <span key={i}>{part.value}</span>;
    });

  const renderWordDiffNew = (wordDiff: WordDiff[]) =>
    wordDiff.map((part, i) => {
      if (part.removed) return null;
      if (part.added) {
        return (
          <span key={i} className="bg-green-300 text-green-900 px-0.5 rounded font-semibold">
            {part.value}
          </span>
        );
      }
      return <span key={i}>{part.value}</span>;
    });

  const renderBlock = (block: DiffBlock, idx: number) => {
    if (block.type === "unchanged") {
      const lines = block.oldLines;
      const collapsed = lines.length > 6;
      return (
        <div key={idx} className="border-b border-gray-100">
          {collapsed ? (
            <div className="px-4 py-2 text-gray-400 text-sm italic bg-gray-50/50 text-center">
              {lines.length} lineas sin cambios (lineas {block.oldStartLine}-
              {block.oldStartLine + lines.length - 1})
            </div>
          ) : (
            lines.map((line, j) => (
              <div key={j} className="flex text-sm text-gray-500 hover:bg-gray-50/80">
                <div className="w-12 text-right pr-2 text-gray-300 select-none shrink-0 py-1 border-r border-gray-100 text-xs">
                  {block.oldStartLine + j}
                </div>
                <div className="pl-4 py-1 flex-1 whitespace-pre-wrap break-words font-mono">
                  {line || "\u00A0"}
                </div>
              </div>
            ))
          )}
        </div>
      );
    }

    if (block.type === "removed") {
      return (
        <div key={idx} className="border-b border-red-200">
          <div className="flex items-center gap-2 px-4 py-1.5 bg-red-100 border-b border-red-200">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full">
              ELIMINADO
            </span>
            <span className="text-red-600 text-xs">
              {block.oldLines.length} linea{block.oldLines.length > 1 ? "s" : ""} eliminada{block.oldLines.length > 1 ? "s" : ""} (linea {block.oldStartLine} del original)
            </span>
          </div>
          {block.oldLines.map((line, j) => (
            <div key={j} className="flex text-sm bg-red-50 hover:bg-red-100/80">
              <div className="w-12 text-right pr-2 text-red-400 select-none shrink-0 py-1 border-r border-red-200 text-xs font-medium">
                {block.oldStartLine + j}
              </div>
              <div className="pl-4 py-1 flex-1 whitespace-pre-wrap break-words font-mono text-red-800 line-through decoration-red-400">
                {line || "\u00A0"}
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (block.type === "added") {
      return (
        <div key={idx} className="border-b border-green-200">
          <div className="flex items-center gap-2 px-4 py-1.5 bg-green-100 border-b border-green-200">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-500 text-white text-xs font-bold rounded-full">
              AGREGADO
            </span>
            <span className="text-green-600 text-xs">
              {block.newLines.length} linea{block.newLines.length > 1 ? "s" : ""} nueva{block.newLines.length > 1 ? "s" : ""} (linea {block.newStartLine} del nuevo)
            </span>
          </div>
          {block.newLines.map((line, j) => (
            <div key={j} className="flex text-sm bg-green-50 hover:bg-green-100/80">
              <div className="w-12 text-right pr-2 text-green-500 select-none shrink-0 py-1 border-r border-green-200 text-xs font-medium">
                {block.newStartLine + j}
              </div>
              <div className="pl-4 py-1 flex-1 whitespace-pre-wrap break-words font-mono text-green-800 font-medium">
                {line || "\u00A0"}
              </div>
            </div>
          ))}
        </div>
      );
    }

    // Modified block - show BEFORE and AFTER clearly
    return (
      <div key={idx} className="border-b border-amber-200">
        <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-100 border-b border-amber-200">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500 text-white text-xs font-bold rounded-full">
            EDITADO
          </span>
          <span className="text-amber-700 text-xs">
            Linea{block.oldLines.length > 1 ? "s" : ""} {block.oldStartLine}
            {block.oldLines.length > 1 ? `-${block.oldStartLine + block.oldLines.length - 1}` : ""} modificada{block.oldLines.length > 1 ? "s" : ""}
          </span>
        </div>

        <div className="flex flex-col lg:flex-row">
          {/* BEFORE column */}
          <div className="flex-1 lg:border-r-2 lg:border-amber-300">
            <div className="px-4 py-1 bg-red-50 border-b border-red-100 flex items-center gap-1.5">
              <span className="text-red-500 text-xs font-bold tracking-wider">ORIGINAL</span>
            </div>
            {block.oldLines.map((line, j) => (
              <div key={j} className="flex text-sm bg-red-50/50 hover:bg-red-50">
                <div className="w-12 text-right pr-2 text-red-300 select-none shrink-0 py-1 border-r border-red-100 text-xs">
                  {block.oldStartLine + j}
                </div>
                <div className="pl-4 py-1 flex-1 whitespace-pre-wrap break-words font-mono text-red-800">
                  {block.wordDiffs && j < block.wordDiffs.length
                    ? renderWordDiffOld(block.wordDiffs[j])
                    : <span className="line-through decoration-red-400">{line || "\u00A0"}</span>
                  }
                </div>
              </div>
            ))}
          </div>

          {/* Arrow divider for mobile */}
          <div className="lg:hidden flex justify-center py-1 bg-amber-50">
            <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </div>

          {/* AFTER column */}
          <div className="flex-1">
            <div className="px-4 py-1 bg-green-50 border-b border-green-100 flex items-center gap-1.5">
              <span className="text-green-600 text-xs font-bold tracking-wider">NUEVO</span>
            </div>
            {block.newLines.map((line, j) => (
              <div key={j} className="flex text-sm bg-green-50/50 hover:bg-green-50">
                <div className="w-12 text-right pr-2 text-green-400 select-none shrink-0 py-1 border-r border-green-100 text-xs">
                  {block.newStartLine + j}
                </div>
                <div className="pl-4 py-1 flex-1 whitespace-pre-wrap break-words font-mono text-green-800">
                  {block.wordDiffs && j < block.wordDiffs.length
                    ? renderWordDiffNew(block.wordDiffs[j])
                    : <span className="font-medium">{line || "\u00A0"}</span>
                  }
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const UploadZone = ({
    target,
    file,
    label,
    icon,
    color,
    inputRef,
  }: {
    target: "old" | "new";
    file: FileInfo | null;
    label: string;
    icon: string;
    color: string;
    inputRef: React.RefObject<HTMLInputElement | null>;
  }) => (
    <div
      className={`upload-zone relative flex-1 border-2 border-dashed rounded-xl p-6 text-center cursor-pointer ${
        dragOver === target
          ? "dragover"
          : file
          ? color === "red"
            ? "border-red-300 bg-red-50"
            : "border-green-300 bg-green-50"
          : "border-gray-300 bg-white"
      }`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(target);
      }}
      onDragLeave={() => setDragOver(null)}
      onDrop={(e) => handleDrop(e, target)}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".docx,.doc,.pdf,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f, target === "old" ? setOldFile : setNewFile);
        }}
      />
      <div className="text-4xl mb-3">{icon}</div>
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {file ? (
        <div
          className={`mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
            color === "red" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {file.name}
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          Arrastra o haz clic para cargar
          <br />
          <span className="text-xs text-gray-400">.docx, .pdf, .txt</span>
        </p>
      )}
    </div>
  );

  const totalChanges = stats ? stats.added + stats.removed + stats.modified : 0;

  return (
    <main className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center text-white text-lg font-bold shadow-md">
              C
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Comparador de Documentos</h1>
              <p className="text-xs text-gray-500">Detecta todos los cambios entre dos archivos Word, PDF o texto</p>
            </div>
          </div>
        </div>
      </header>

      {/* Upload Section */}
      <section className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-6 sm:px-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <UploadZone target="old" file={oldFile} label="Documento Original (viejo)" icon="📄" color="red" inputRef={oldInputRef} />
            <div className="flex items-center justify-center">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-lg">
                VS
              </div>
            </div>
            <UploadZone target="new" file={newFile} label="Documento Nuevo" icon="📝" color="green" inputRef={newInputRef} />
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="mt-5 flex justify-center">
            <button
              onClick={computeDiff}
              disabled={!oldFile || !newFile || loading}
              className="px-8 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold rounded-xl shadow-md hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer text-base"
            >
              {loading ? "Analizando cambios..." : "Comparar Documentos"}
            </button>
          </div>
        </div>
      </section>

      {/* Results */}
      {stats && (
        <>
          {/* Summary cards */}
          <section className="bg-white border-b border-gray-200">
            <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-gray-800">Resumen:</span>
                  <span className="text-sm text-gray-500">{totalChanges} cambio{totalChanges !== 1 ? "s" : ""} encontrado{totalChanges !== 1 ? "s" : ""}</span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setFilter("all")}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer border ${
                      filter === "all"
                        ? "bg-gray-800 text-white border-gray-800"
                        : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    Todos ({totalChanges})
                  </button>
                  <button
                    onClick={() => setFilter("added")}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer border ${
                      filter === "added"
                        ? "bg-green-500 text-white border-green-500"
                        : "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                    }`}
                  >
                    + Agregado ({stats.added})
                  </button>
                  <button
                    onClick={() => setFilter("removed")}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer border ${
                      filter === "removed"
                        ? "bg-red-500 text-white border-red-500"
                        : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                    }`}
                  >
                    - Eliminado ({stats.removed})
                  </button>
                  <button
                    onClick={() => setFilter("modified")}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer border ${
                      filter === "modified"
                        ? "bg-amber-500 text-white border-amber-500"
                        : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                    }`}
                  >
                    ~ Editado ({stats.modified})
                  </button>
                </div>

                {filter === "all" && (
                  <label className="flex items-center gap-2 text-sm text-gray-600 ml-auto cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showUnchanged}
                      onChange={(e) => setShowUnchanged(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 cursor-pointer"
                    />
                    Mostrar lineas sin cambios
                  </label>
                )}
              </div>

              {/* Visual bar */}
              {totalChanges > 0 && (
                <div className="mt-3 flex h-3 rounded-full overflow-hidden bg-gray-100 border border-gray-200">
                  {stats.added > 0 && (
                    <div
                      className="bg-green-500 transition-all"
                      style={{ width: `${(stats.added / totalChanges) * 100}%` }}
                      title={`${stats.added} agregadas`}
                    />
                  )}
                  {stats.modified > 0 && (
                    <div
                      className="bg-amber-400 transition-all"
                      style={{ width: `${(stats.modified / totalChanges) * 100}%` }}
                      title={`${stats.modified} modificadas`}
                    />
                  )}
                  {stats.removed > 0 && (
                    <div
                      className="bg-red-500 transition-all"
                      style={{ width: `${(stats.removed / totalChanges) * 100}%` }}
                      title={`${stats.removed} eliminadas`}
                    />
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Diff blocks */}
          <section className="flex-1 overflow-auto comparison-panel pb-8">
            <div className="max-w-7xl mx-auto mt-4 px-4 sm:px-6">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                {filteredBlocks.length > 0 ? (
                  filteredBlocks.map((block, idx) => renderBlock(block, idx))
                ) : (
                  <div className="py-12 text-center text-gray-400">
                    <p className="text-lg">No hay cambios de tipo &quot;{filter}&quot;</p>
                  </div>
                )}
              </div>
            </div>
          </section>
        </>
      )}

      {/* Empty state */}
      {!stats && !loading && (
        <div className="flex-1 flex items-center justify-center py-20 text-gray-400">
          <div className="text-center">
            <div className="text-6xl mb-4 opacity-40">📋</div>
            <p className="text-lg font-medium">Carga ambos documentos y presiona &quot;Comparar&quot;</p>
            <p className="text-sm mt-1">Los cambios se mostraran organizados por tipo con colores claros</p>
          </div>
        </div>
      )}
    </main>
  );
}
