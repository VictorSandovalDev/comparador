"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

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

type Stats = {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
};

type FilterType = "all" | "added" | "removed" | "modified";

type ComparisonData = {
  oldFileName: string;
  newFileName: string;
  diffBlocks: DiffBlock[];
  stats: Stats;
  createdAt: string;
  expiresAt: string;
};

function ShareContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");

  const [data, setData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [showUnchanged, setShowUnchanged] = useState(true);

  useEffect(() => {
    if (!id) {
      setError("No se proporcionó un ID de comparación");
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        const snap = await getDoc(doc(db, "comparisons", id));
        if (!snap.exists()) {
          setError("Esta comparación no existe o ha expirado");
          setLoading(false);
          return;
        }
        const raw = snap.data();
        const d: ComparisonData = {
          ...raw as ComparisonData,
          diffBlocks: typeof raw.diffBlocks === "string" ? JSON.parse(raw.diffBlocks) : raw.diffBlocks,
        };
        if (new Date(d.expiresAt) < new Date()) {
          setError("Este enlace ha expirado");
          setLoading(false);
          return;
        }
        setData(d);
      } catch {
        setError("Error al cargar la comparación");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const filteredBlocks = useCallback(() => {
    if (!data) return [];
    return data.diffBlocks.filter((b) => {
      if (filter === "all") return showUnchanged || b.type !== "unchanged";
      return b.type === filter;
    });
  }, [data, filter, showUnchanged]);

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

    // Modified block
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

          <div className="lg:hidden flex justify-center py-1 bg-amber-50">
            <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </div>

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

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 font-medium">Cargando comparación...</p>
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="text-6xl mb-4">🔗</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Enlace no disponible</h1>
          <p className="text-gray-500">{error || "No se pudo cargar la comparación"}</p>
          <a
            href="./"
            className="inline-block mt-6 px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            Ir al Comparador
          </a>
        </div>
      </main>
    );
  }

  const totalChanges = data.stats.added + data.stats.removed + data.stats.modified;
  const blocks = filteredBlocks();
  const expiresDate = new Date(data.expiresAt).toLocaleDateString("es-ES", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center text-white text-lg font-bold shadow-md">
              C
            </div>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-gray-900">Comparador de Documentos</h1>
              <p className="text-xs text-gray-500">Vista compartida (solo lectura)</p>
            </div>
            <div className="text-right">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 border border-amber-200 rounded-full text-xs text-amber-700">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Expira el {expiresDate}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* File info */}
      <section className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4 sm:px-6">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
            <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 rounded-lg">
              <span className="text-lg">📄</span>
              <div>
                <p className="text-xs text-red-500 font-medium">Original</p>
                <p className="text-sm font-semibold text-gray-700">{data.oldFileName}</p>
              </div>
            </div>
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-sm">
              VS
            </div>
            <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-lg">
              <span className="text-lg">📝</span>
              <div>
                <p className="text-xs text-green-500 font-medium">Nuevo</p>
                <p className="text-sm font-semibold text-gray-700">{data.newFileName}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Summary */}
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
                  filter === "all" ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                }`}
              >
                Todos ({totalChanges})
              </button>
              <button
                onClick={() => setFilter("added")}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer border ${
                  filter === "added" ? "bg-green-500 text-white border-green-500" : "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                }`}
              >
                + Agregado ({data.stats.added})
              </button>
              <button
                onClick={() => setFilter("removed")}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer border ${
                  filter === "removed" ? "bg-red-500 text-white border-red-500" : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                }`}
              >
                - Eliminado ({data.stats.removed})
              </button>
              <button
                onClick={() => setFilter("modified")}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer border ${
                  filter === "modified" ? "bg-amber-500 text-white border-amber-500" : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                }`}
              >
                ~ Editado ({data.stats.modified})
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

          {totalChanges > 0 && (
            <div className="mt-3 flex h-3 rounded-full overflow-hidden bg-gray-100 border border-gray-200">
              {data.stats.added > 0 && (
                <div className="bg-green-500 transition-all" style={{ width: `${(data.stats.added / totalChanges) * 100}%` }} />
              )}
              {data.stats.modified > 0 && (
                <div className="bg-amber-400 transition-all" style={{ width: `${(data.stats.modified / totalChanges) * 100}%` }} />
              )}
              {data.stats.removed > 0 && (
                <div className="bg-red-500 transition-all" style={{ width: `${(data.stats.removed / totalChanges) * 100}%` }} />
              )}
            </div>
          )}
        </div>
      </section>

      {/* Diff blocks */}
      <section className="flex-1 overflow-auto pb-8">
        <div className="max-w-7xl mx-auto mt-4 px-4 sm:px-6">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {blocks.length > 0 ? (
              blocks.map((block, idx) => renderBlock(block, idx))
            ) : (
              <div className="py-12 text-center text-gray-400">
                <p className="text-lg">No hay cambios de tipo &quot;{filter}&quot;</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

export default function SharePage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </main>
    }>
      <ShareContent />
    </Suspense>
  );
}
