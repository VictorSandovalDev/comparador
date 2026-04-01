"use client";

import { useState, useCallback, useRef } from "react";
import * as Diff from "diff";
import mammoth from "mammoth";
import jsPDF from "jspdf";
import { db } from "@/lib/firebase";
import { doc, setDoc } from "firebase/firestore";

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
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const generateReport = useCallback(() => {
    if (!stats || !oldFile || !newFile) return;

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentW = pageW - margin * 2;
    let y = margin;

    const checkPage = (needed: number) => {
      if (y + needed > pageH - 15) {
        doc.addPage();
        y = margin;
      }
    };

    const drawRect = (x: number, yPos: number, w: number, h: number, color: [number, number, number]) => {
      doc.setFillColor(color[0], color[1], color[2]);
      doc.roundedRect(x, yPos, w, h, 2, 2, "F");
    };

    const wrapText = (text: string, maxW: number, fontSize: number): string[] => {
      doc.setFontSize(fontSize);
      return doc.splitTextToSize(text || " ", maxW) as string[];
    };

    // --- HEADER ---
    drawRect(margin, y, contentW, 22, [59, 130, 246]);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("Informe de Comparacion", pageW / 2, y + 9, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("Comparador de Documentos", pageW / 2, y + 17, { align: "center" });
    y += 28;

    // --- INFO BOX ---
    drawRect(margin, y, contentW, 20, [243, 244, 246]);
    doc.setTextColor(55, 65, 81);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("Fecha:", margin + 4, y + 6);
    doc.text("Original:", margin + 4, y + 12);
    doc.text("Nuevo:", margin + 4, y + 18);
    doc.setFont("helvetica", "normal");
    doc.text(new Date().toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }), margin + 22, y + 6);
    doc.text(oldFile.name, margin + 22, y + 12);
    doc.text(newFile.name, margin + 22, y + 18);
    y += 26;

    // --- STATS ---
    const totalChanges = stats.added + stats.removed + stats.modified;
    const statBoxW = contentW / 4 - 2;

    const statItems: { label: string; value: number; color: [number, number, number]; bg: [number, number, number] }[] = [
      { label: "Agregadas", value: stats.added, color: [22, 163, 74], bg: [220, 252, 231] },
      { label: "Eliminadas", value: stats.removed, color: [220, 38, 38], bg: [254, 226, 226] },
      { label: "Editadas", value: stats.modified, color: [217, 119, 6], bg: [254, 243, 199] },
      { label: "Sin cambios", value: stats.unchanged, color: [107, 114, 128], bg: [243, 244, 246] },
    ];

    statItems.forEach((item, i) => {
      const x = margin + i * (statBoxW + 2.5);
      drawRect(x, y, statBoxW, 16, item.bg);
      doc.setTextColor(item.color[0], item.color[1], item.color[2]);
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text(String(item.value), x + statBoxW / 2, y + 7, { align: "center" });
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text(item.label, x + statBoxW / 2, y + 13, { align: "center" });
    });
    y += 22;

    // --- PROGRESS BAR ---
    if (totalChanges > 0) {
      const barH = 4;
      let barX = margin;
      const colors: { count: number; color: [number, number, number] }[] = [
        { count: stats.added, color: [34, 197, 94] },
        { count: stats.modified, color: [251, 191, 36] },
        { count: stats.removed, color: [239, 68, 68] },
      ];
      colors.forEach(({ count, color }) => {
        if (count > 0) {
          const w = (count / totalChanges) * contentW;
          doc.setFillColor(color[0], color[1], color[2]);
          doc.rect(barX, y, w, barH, "F");
          barX += w;
        }
      });
      y += 8;
    }

    // --- SECTION TITLE ---
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(31, 41, 55);
    doc.text("Detalle de Cambios", margin, y + 5);
    y += 10;
    doc.setDrawColor(209, 213, 219);
    doc.line(margin, y, pageW - margin, y);
    y += 4;

    // --- CHANGE BLOCKS ---
    let changeNum = 0;
    for (const block of diffBlocks) {
      if (block.type === "unchanged") continue;
      changeNum++;

      const labelMap = {
        removed: { text: "ELIMINADO", bg: [254, 226, 226] as [number, number, number], badge: [220, 38, 38] as [number, number, number], textColor: [153, 27, 27] as [number, number, number] },
        added: { text: "AGREGADO", bg: [220, 252, 231] as [number, number, number], badge: [22, 163, 74] as [number, number, number], textColor: [20, 83, 45] as [number, number, number] },
        modified: { text: "EDITADO", bg: [254, 243, 199] as [number, number, number], badge: [217, 119, 6] as [number, number, number], textColor: [120, 53, 15] as [number, number, number] },
      };
      const style = labelMap[block.type as keyof typeof labelMap];

      checkPage(20);

      // Badge header
      drawRect(margin, y, contentW, 8, style.bg);
      drawRect(margin + 2, y + 1.5, 24, 5, style.badge);
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(6);
      doc.setFont("helvetica", "bold");
      doc.text(style.text, margin + 14, y + 5, { align: "center" });

      doc.setTextColor(style.textColor[0], style.textColor[1], style.textColor[2]);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      const lineInfo = block.type === "added"
        ? `#${changeNum} - Linea ${block.newStartLine} del nuevo`
        : `#${changeNum} - Linea ${block.oldStartLine} del original`;
      doc.text(lineInfo, margin + 28, y + 5);
      y += 10;

      const printLines = (lines: string[], prefix: string, color: [number, number, number]) => {
        for (const line of lines) {
          const wrapped = wrapText(`${prefix} ${line}`, contentW - 10, 8);
          checkPage(wrapped.length * 4 + 2);
          doc.setTextColor(color[0], color[1], color[2]);
          doc.setFontSize(8);
          doc.setFont("courier", "normal");
          for (const wl of wrapped) {
            doc.text(wl, margin + 4, y + 3);
            y += 4;
          }
        }
      };

      if (block.type === "removed") {
        printLines(block.oldLines, "-", [153, 27, 27]);
      } else if (block.type === "added") {
        printLines(block.newLines, "+", [20, 83, 45]);
      } else if (block.type === "modified") {
        doc.setFontSize(7);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(153, 27, 27);
        doc.text("ORIGINAL:", margin + 4, y + 3);
        y += 5;
        printLines(block.oldLines, "-", [153, 27, 27]);

        y += 2;
        doc.setFontSize(7);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(20, 83, 45);
        doc.text("NUEVO:", margin + 4, y + 3);
        y += 5;
        printLines(block.newLines, "+", [20, 83, 45]);

        if (block.wordDiffs) {
          let hasWordChanges = false;
          for (const wd of block.wordDiffs) {
            const removed = wd.filter((w) => w.removed).map((w) => w.value.trim()).filter(Boolean);
            const added = wd.filter((w) => w.added).map((w) => w.value.trim()).filter(Boolean);
            if (removed.length > 0 || added.length > 0) {
              if (!hasWordChanges) {
                y += 2;
                checkPage(8);
                doc.setFontSize(7);
                doc.setFont("helvetica", "bold");
                doc.setTextColor(120, 53, 15);
                doc.text("Cambios especificos:", margin + 4, y + 3);
                y += 5;
                hasWordChanges = true;
              }
              checkPage(8);
              doc.setFontSize(7);
              doc.setFont("helvetica", "normal");
              if (removed.length > 0) {
                doc.setTextColor(153, 27, 27);
                doc.text(`Se quito: "${removed.join(" ")}"`, margin + 8, y + 3);
                y += 4;
              }
              if (added.length > 0) {
                checkPage(5);
                doc.setTextColor(20, 83, 45);
                doc.text(`Se agrego: "${added.join(" ")}"`, margin + 8, y + 3);
                y += 4;
              }
            }
          }
        }
      }

      y += 4;
      doc.setDrawColor(229, 231, 235);
      doc.line(margin, y, pageW - margin, y);
      y += 4;
    }

    // --- FOOTER ---
    checkPage(12);
    y += 4;
    drawRect(margin, y, contentW, 8, [243, 244, 246]);
    doc.setTextColor(107, 114, 128);
    doc.setFontSize(7);
    doc.setFont("helvetica", "italic");
    doc.text("Generado por Comparador de Documentos", pageW / 2, y + 5, { align: "center" });

    doc.save(`informe-comparacion-${new Date().toISOString().slice(0, 10)}.pdf`);
  }, [stats, oldFile, newFile, diffBlocks]);

  const shareComparison = useCallback(async () => {
    if (!stats || !oldFile || !newFile || diffBlocks.length === 0) return;
    setSharing(true);
    setShareUrl(null);
    try {
      const id = crypto.randomUUID().slice(0, 12);
      const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      await setDoc(doc(db, "comparisons", id), {
        oldFileName: oldFile.name,
        newFileName: newFile.name,
        diffBlocks,
        stats,
        createdAt: new Date().toISOString(),
        expiresAt,
      });
      const base = window.location.origin + window.location.pathname.replace(/\/$/, "");
      const url = `${base}/share?id=${id}`;
      setShareUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al compartir");
    } finally {
      setSharing(false);
    }
  }, [stats, oldFile, newFile, diffBlocks]);

  const copyShareUrl = useCallback(() => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [shareUrl]);

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
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showUnchanged}
                      onChange={(e) => setShowUnchanged(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 cursor-pointer"
                    />
                    Mostrar lineas sin cambios
                  </label>
                )}

                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={generateReport}
                    className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer border bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Descargar PDF
                  </button>
                  <button
                    onClick={shareComparison}
                    disabled={sharing}
                    className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer border bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 flex items-center gap-2 disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                    {sharing ? "Generando..." : "Compartir"}
                  </button>
                </div>
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

              {/* Share URL */}
              {shareUrl && (
                <div className="mt-3 flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <svg className="w-5 h-5 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    className="flex-1 bg-white border border-emerald-300 rounded px-3 py-1.5 text-sm text-gray-700 font-mono"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    onClick={copyShareUrl}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shrink-0"
                  >
                    {copied ? "Copiado!" : "Copiar"}
                  </button>
                  <span className="text-xs text-emerald-600 shrink-0">Expira en 3 dias</span>
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
