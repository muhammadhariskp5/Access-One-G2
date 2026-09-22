import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Printer, 
  CheckCircle2, 
  Sliders, 
  Eye, 
  Download, 
  FileSpreadsheet, 
  FileDown, 
  Loader2, 
  Minimize2, 
  Maximize2, 
  ZoomIn, 
  ZoomOut, 
  Scaling, 
  LayoutTemplate,
  RotateCw,
  FileCheck
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas-pro';
import { Modal } from './Modal';
import { cn } from '../../lib/utils';

export type FitMode = 'fit-width' | 'fit-page' | 'custom';
export type PageSize = 'a4' | 'letter' | 'legal' | 'a3';
export type MarginSize = 'none' | 'narrow' | 'normal' | 'wide';

export interface PrintExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  documentTitle?: string;
  onPrint?: () => void;
  onExportExcel?: () => void;
  children?: React.ReactNode;
  defaultOrientation?: 'portrait' | 'landscape';
  defaultFitMode?: FitMode;
  defaultPageSize?: PageSize;
  defaultScale?: number;
}

const PAGE_SPECS: Record<PageSize, { name: string; width: number; height: number }> = {
  a4: { name: 'Standard A4', width: 210, height: 297 },
  letter: { name: 'US Letter', width: 215.9, height: 279.4 },
  legal: { name: 'US Legal', width: 215.9, height: 355.6 },
  a3: { name: 'A3 (Wide Matrix)', width: 297, height: 420 },
};

const MARGIN_SPECS: Record<MarginSize, { label: string; mm: number }> = {
  none: { label: '0 mm (None)', mm: 0 },
  narrow: { label: '5 mm (Narrow)', mm: 5 },
  normal: { label: '10 mm (Normal)', mm: 10 },
  wide: { label: '18 mm (Wide)', mm: 18 },
};

export function PrintExportModal({
  isOpen,
  onClose,
  title = "Print / Export Report",
  documentTitle = "Document",
  onPrint,
  onExportExcel,
  children,
  defaultOrientation = 'portrait',
  defaultFitMode = 'fit-width',
  defaultPageSize = 'a4',
  defaultScale = 100
}: PrintExportModalProps) {
  const [includeBackgrounds, setIncludeBackgrounds] = useState(true);
  const [includeHeaderFooter, setIncludeHeaderFooter] = useState(true);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>(defaultOrientation);
  const [pageSize, setPageSize] = useState<PageSize>(defaultPageSize);
  const [marginSize, setMarginSize] = useState<MarginSize>('normal');
  const [fitMode, setFitMode] = useState<FitMode>(defaultFitMode);
  const [customScale, setCustomScale] = useState<number>(defaultScale);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const [docDimensions, setDocDimensions] = useState({ scrollWidth: 800, scrollHeight: 600 });

  // Measure content dimensions when modal opens or layout changes
  useEffect(() => {
    if (isOpen && contentRef.current) {
      const updateDimensions = () => {
        if (contentRef.current) {
          setDocDimensions({
            scrollWidth: contentRef.current.scrollWidth || 800,
            scrollHeight: contentRef.current.scrollHeight || 600
          });
        }
      };
      const timer = setTimeout(updateDimensions, 120);
      return () => clearTimeout(timer);
    }
  }, [isOpen, children, orientation, pageSize]);

  // Paper geometry in millimeters
  const { paperWidthMm, paperHeightMm, marginMm, printableWidthMm, printableHeightMm } = useMemo(() => {
    const spec = PAGE_SPECS[pageSize];
    const width = orientation === 'landscape' ? spec.height : spec.width;
    const height = orientation === 'landscape' ? spec.width : spec.height;
    const m = MARGIN_SPECS[marginSize].mm;
    const headerFooterSpace = includeHeaderFooter ? 12 : 0;
    return {
      paperWidthMm: width,
      paperHeightMm: height,
      marginMm: m,
      printableWidthMm: Math.max(20, width - m * 2),
      printableHeightMm: Math.max(20, height - m * 2 - headerFooterSpace),
    };
  }, [pageSize, orientation, marginSize, includeHeaderFooter]);

  // Calculate the scale needed to fit everything on exactly 1 single page
  const autoFit1PagePercent = useMemo(() => {
    if (!docDimensions.scrollWidth || !docDimensions.scrollHeight) return 100;
    const widthScale = 1;
    const heightFitRatio = (printableHeightMm / docDimensions.scrollHeight) / (printableWidthMm / docDimensions.scrollWidth);
    const percent = Math.max(30, Math.min(100, Math.round(Math.min(widthScale, heightFitRatio) * 100)));
    return percent;
  }, [printableHeightMm, printableWidthMm, docDimensions]);

  // Determine active scale percentage based on fitMode
  const activeScalePercent = useMemo(() => {
    if (fitMode === 'fit-page') {
      return autoFit1PagePercent;
    }
    if (fitMode === 'custom') {
      return customScale;
    }
    return 100; // fit-width
  }, [fitMode, autoFit1PagePercent, customScale]);

  // Estimated page count for the user
  const estimatedPages = useMemo(() => {
    if (fitMode === 'fit-page') return 1;
    if (!docDimensions.scrollWidth || !docDimensions.scrollHeight) return 1;
    const effectiveHeightMm = docDimensions.scrollHeight * (printableWidthMm / docDimensions.scrollWidth) * (activeScalePercent / 100);
    return Math.max(1, Math.ceil(effectiveHeightMm / printableHeightMm));
  }, [fitMode, docDimensions, printableWidthMm, printableHeightMm, activeScalePercent]);

  // Auto-fit to 1 page handler
  const handleAutoFitOnePage = () => {
    setFitMode('fit-page');
    setCustomScale(autoFit1PagePercent);
  };

  const getFullPrintHTML = () => {
    const contentHtml = contentRef.current ? contentRef.current.innerHTML : '';
    const scaleFactor = (activeScalePercent / 100).toFixed(2);
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${documentTitle}</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <style>
            @page {
              size: ${pageSize} ${orientation};
              margin: ${marginMm}mm;
            }
            @media print {
              body {
                background-color: #ffffff !important;
                color: #1a1a1a !important;
                -webkit-print-color-adjust: ${includeBackgrounds ? 'exact' : 'economy'} !important;
                print-color-adjust: ${includeBackgrounds ? 'exact' : 'economy'} !important;
                color-adjust: ${includeBackgrounds ? 'exact' : 'economy'} !important;
                zoom: ${scaleFactor};
              }
              .printable-document {
                transform: scale(${scaleFactor});
                transform-origin: top center;
              }
            }
            body {
              font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              padding: ${marginMm > 0 ? marginMm : 10}mm;
              margin: 0;
              background-color: #ffffff;
              color: #1a1a1a;
            }
            table {
              width: 100%;
              border-collapse: collapse;
            }
            *, *::before, *::after {
              -webkit-print-color-adjust: ${includeBackgrounds ? 'exact' : 'economy'} !important;
              print-color-adjust: ${includeBackgrounds ? 'exact' : 'economy'} !important;
              color-adjust: ${includeBackgrounds ? 'exact' : 'economy'} !important;
            }
          </style>
        </head>
        <body>
          <div class="printable-document">
            ${contentHtml}
          </div>
        </body>
      </html>
    `;
  };

  const handleDownloadPDF = async () => {
    if (!contentRef.current) return;
    setIsGeneratingPDF(true);
    const cleanFilename = `${documentTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`;

    try {
      const element = contentRef.current;
      const naturalWidth = Math.max(element.scrollWidth, element.offsetWidth, 1024);

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: naturalWidth,
        onclone: (clonedDoc, clonedElement) => {
          // 1. Sanitize CSS in cloned iframe to prevent legacy CSS parsers from tripping on modern color functions
          try {
            const styles = clonedDoc.querySelectorAll('style');
            styles.forEach((styleTag) => {
              if (styleTag.textContent && styleTag.textContent.includes('color-mix')) {
                styleTag.textContent = styleTag.textContent
                  .replace(/@supports\s*\([^{]+\{[^}]*color-mix[^}]*\}\}/gi, '')
                  .replace(/color-mix\([^)]+\)/gi, 'transparent');
              }
            });
          } catch (e) {
            console.warn("Style sanitize warning:", e);
          }

          // 2. Unconstrain preview styling and ensure clean full capture without transform artifacts
          clonedElement.style.transform = 'none';
          clonedElement.style.transformOrigin = 'initial';
          clonedElement.style.width = `${naturalWidth}px`;
          clonedElement.style.maxWidth = 'none';
          clonedElement.style.maxHeight = 'none';
          clonedElement.style.overflow = 'visible';
          clonedElement.style.backgroundColor = '#ffffff';

          const scrollables = clonedElement.querySelectorAll(
            '.overflow-y-auto, .overflow-x-auto, [class*="max-h-"]'
          );
          scrollables.forEach((node) => {
            const htmlEl = node as HTMLElement;
            htmlEl.style.maxHeight = 'none';
            htmlEl.style.overflow = 'visible';
          });
        }
      });

      const pdf = new jsPDF({
        orientation: orientation,
        unit: 'mm',
        format: pageSize === 'letter' ? 'letter' : pageSize === 'legal' ? 'legal' : pageSize === 'a3' ? 'a3' : 'a4'
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const margin = MARGIN_SPECS[marginSize].mm;
      const headerSpace = includeHeaderFooter ? 12 : 0;
      const availWidth = Math.max(10, pdfWidth - margin * 2);
      const availHeight = Math.max(10, pdfHeight - margin * 2 - headerSpace);

      // Determine draw scale
      let scaleFactor: number;
      if (fitMode === 'fit-page') {
        const scaleX = availWidth / canvas.width;
        const scaleY = availHeight / canvas.height;
        scaleFactor = Math.min(scaleX, scaleY);
      } else if (fitMode === 'custom') {
        scaleFactor = (availWidth / canvas.width) * (customScale / 100);
      } else {
        // fit-width
        scaleFactor = availWidth / canvas.width;
      }

      const finalDrawWidth = canvas.width * scaleFactor;
      const totalDrawHeight = canvas.height * scaleFactor;

      // SINGLE PAGE FIT
      if (fitMode === 'fit-page' || totalDrawHeight <= availHeight) {
        const posX = margin + (availWidth - finalDrawWidth) / 2;
        const posY = margin + (includeHeaderFooter ? 6 : 0) + (availHeight - totalDrawHeight) / 2;

        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', posX, posY, finalDrawWidth, totalDrawHeight);

        if (includeHeaderFooter) {
          pdf.setFontSize(8);
          pdf.setFont('helvetica', 'normal');
          pdf.setTextColor(120, 120, 120);
          pdf.text(documentTitle, margin, margin + 4);
          pdf.text(new Date().toLocaleDateString(), pdfWidth - margin, margin + 4, { align: 'right' });
          pdf.text("AccessOne Security Pass Management", margin, pdfHeight - margin + 2);
          pdf.text("Page 1 of 1", pdfWidth - margin, pdfHeight - margin + 2, { align: 'right' });
        }
      } else {
        // MULTI-PAGE SLICING with offscreen canvas for exact margin preservation
        const canvasPixelsPerPage = Math.floor(availHeight / scaleFactor);
        const totalPages = Math.ceil(canvas.height / canvasPixelsPerPage);

        let currentY = 0;
        let pageNum = 1;

        while (currentY < canvas.height) {
          if (pageNum > 1) {
            pdf.addPage();
          }

          const sliceHeight = Math.min(canvasPixelsPerPage, canvas.height - currentY);
          const sliceCanvas = document.createElement('canvas');
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = Math.max(1, sliceHeight);
          const sCtx = sliceCanvas.getContext('2d');
          if (sCtx) {
            sCtx.fillStyle = '#ffffff';
            sCtx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
            sCtx.drawImage(
              canvas,
              0, currentY, canvas.width, sliceHeight,
              0, 0, canvas.width, sliceHeight
            );
          }

          const sliceImgData = sliceCanvas.toDataURL('image/png');
          const sliceDrawHeight = sliceHeight * scaleFactor;
          const posX = margin + (availWidth - finalDrawWidth) / 2;
          const posY = margin + (includeHeaderFooter ? 6 : 0);

          pdf.addImage(sliceImgData, 'PNG', posX, posY, finalDrawWidth, sliceDrawHeight);

          if (includeHeaderFooter) {
            pdf.setFontSize(8);
            pdf.setFont('helvetica', 'normal');
            pdf.setTextColor(120, 120, 120);
            pdf.text(documentTitle, margin, margin + 4);
            pdf.text(new Date().toLocaleDateString(), pdfWidth - margin, margin + 4, { align: 'right' });
            pdf.text("AccessOne Security Pass Management", margin, pdfHeight - margin + 2);
            pdf.text(`Page ${pageNum} of ${totalPages}`, pdfWidth - margin, pdfHeight - margin + 2, { align: 'right' });
          }

          currentY += sliceHeight;
          pageNum++;
        }
      }

      pdf.save(cleanFilename);
    } catch (err) {
      console.error("PDF canvas generation error, using direct PDF fallback:", err);
      try {
        // Direct jsPDF fallback: NEVER download HTML when user requested PDF
        const fallbackPdf = new jsPDF({
          orientation: orientation,
          unit: 'mm',
          format: pageSize === 'letter' ? 'letter' : pageSize === 'legal' ? 'legal' : pageSize === 'a3' ? 'a3' : 'a4'
        });

        const pageWidth = fallbackPdf.internal.pageSize.getWidth();
        const pageHeight = fallbackPdf.internal.pageSize.getHeight();
        const margin = MARGIN_SPECS[marginSize].mm;
        let yPos = margin + 10;

        fallbackPdf.setFontSize(15);
        fallbackPdf.setFont('helvetica', 'bold');
        fallbackPdf.setTextColor(128, 0, 32); // #800020
        fallbackPdf.text(title || 'Report Export', margin, yPos);
        yPos += 7;

        fallbackPdf.setFontSize(8);
        fallbackPdf.setFont('helvetica', 'normal');
        fallbackPdf.setTextColor(100, 100, 100);
        fallbackPdf.text(`Generated: ${new Date().toLocaleString()}  |  Ref: ${documentTitle}  |  Fit: ${activeScalePercent}%`, margin, yPos);
        yPos += 7;
        fallbackPdf.setDrawColor(220, 220, 220);
        fallbackPdf.line(margin, yPos, pageWidth - margin, yPos);
        yPos += 8;

        fallbackPdf.setTextColor(20, 20, 20);
        if (contentRef.current) {
          const rawText = contentRef.current.innerText || '';
          const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
          const fontSize = fitMode === 'fit-page' ? Math.max(6, Math.min(10, Math.floor(9 * (activeScalePercent / 100)))) : 9;
          fallbackPdf.setFontSize(fontSize);
          const lineHeight = fontSize * 0.45;

          for (const line of lines) {
            const wrapped = fallbackPdf.splitTextToSize(line, pageWidth - (margin * 2));
            for (const wl of wrapped) {
              if (yPos > pageHeight - margin - 10) {
                if (fitMode === 'fit-page') break;
                fallbackPdf.addPage();
                yPos = margin + 10;
              }
              fallbackPdf.text(wl, margin, yPos);
              yPos += lineHeight;
            }
          }
        }

        fallbackPdf.save(cleanFilename);
      } catch (fallbackErr) {
        console.error("Critical fallback PDF error:", fallbackErr);
      }
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const handleTriggerPrint = () => {
    if (onPrint) {
      onPrint();
      return;
    }

    try {
      const printContainerId = 'applet-active-print-overlay';
      const existing = document.getElementById(printContainerId);
      if (existing) existing.remove();

      const printDiv = document.createElement('div');
      printDiv.id = printContainerId;
      printDiv.innerHTML = getFullPrintHTML();
      document.body.appendChild(printDiv);

      const styleId = 'applet-print-style-rules';
      const existingStyle = document.getElementById(styleId);
      if (existingStyle) existingStyle.remove();

      const styleEl = document.createElement('style');
      styleEl.id = styleId;
      styleEl.innerHTML = `
        @media screen {
          #${printContainerId} { display: none !important; }
        }
        @media print {
          body > *:not(#${printContainerId}) { display: none !important; }
          #${printContainerId} { display: block !important; width: 100% !important; background: white !important; }
        }
      `;
      document.head.appendChild(styleEl);

      window.focus();
      window.print();

      setTimeout(() => {
        printDiv.remove();
        styleEl.remove();
      }, 2000);
    } catch (err) {
      console.warn("Direct window.print failed, opening in new tab:", err);
      handleOpenInNewTab();
    }
  };

  const handleOpenInNewTab = () => {
    try {
      const printWin = window.open('', '_blank');
      if (printWin && !printWin.closed) {
        printWin.document.write(getFullPrintHTML() + `
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.focus();
                window.print();
              }, 400);
            };
          </script>
        `);
        printWin.document.close();
      } else {
        handleDownloadPDF();
      }
    } catch (e) {
      handleDownloadPDF();
    }
  };

  const handleDownloadHTML = () => {
    const blob = new Blob([getFullPrintHTML()], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${documentTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportToExcel = () => {
    if (onExportExcel) {
      onExportExcel();
      return;
    }

    try {
      if (contentRef.current) {
        const table = contentRef.current.querySelector('table');
        if (table) {
          const wb = XLSX.utils.table_to_book(table, { raw: true });
          XLSX.writeFile(wb, `${documentTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.xlsx`);
          return;
        }
      }
      alert('No tabular data found to export to Excel.');
    } catch (err) {
      console.error('Error exporting to Excel:', err);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="5xl">
      <div className="space-y-4 font-sans text-slate-800">
        {/* TOP CONTROLS & FITTING DASHBOARD */}
        <div className="p-4 bg-slate-50 border border-slate-200/90 rounded-2xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2">
              <Sliders size={16} className="text-[#800020]" />
              <p className="text-xs font-bold text-slate-900 uppercase tracking-wider">PDF Page Fitting & Print Layout</p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[11px] font-semibold text-slate-500">Document:</span>
              <span className="font-bold text-slate-800 bg-white px-2 py-0.5 rounded-md border border-slate-200 shadow-2xs">
                {documentTitle}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Page Fitting Mode */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider block">
                  PDF Page Fitting
                </label>
                <span className="text-[9px] font-bold text-[#800020] uppercase">
                  {fitMode === 'fit-page' ? '1 Page Fit' : fitMode === 'fit-width' ? 'Fit Width' : `${customScale}% Scale`}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-2xs">
                <button
                  type="button"
                  id="btn-fit-width"
                  onClick={() => setFitMode('fit-width')}
                  className={cn(
                    "py-1.5 px-1 text-[10px] font-bold rounded-lg transition-all cursor-pointer flex flex-col items-center gap-0.5 text-center",
                    fitMode === 'fit-width' ? "bg-slate-900 text-white shadow-xs" : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  )}
                  title="Fit content to page width; paginates naturally across pages"
                >
                  <Maximize2 size={12} />
                  <span>Fit Width</span>
                </button>
                <button
                  type="button"
                  id="btn-fit-page"
                  onClick={handleAutoFitOnePage}
                  className={cn(
                    "py-1.5 px-1 text-[10px] font-bold rounded-lg transition-all cursor-pointer flex flex-col items-center gap-0.5 text-center",
                    fitMode === 'fit-page' ? "bg-[#800020] text-white shadow-xs" : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  )}
                  title="Shrink and fit entire document cleanly onto 1 single page"
                >
                  <Minimize2 size={12} />
                  <span>Fit 1 Page</span>
                </button>
                <button
                  type="button"
                  id="btn-fit-custom"
                  onClick={() => setFitMode('custom')}
                  className={cn(
                    "py-1.5 px-1 text-[10px] font-bold rounded-lg transition-all cursor-pointer flex flex-col items-center gap-0.5 text-center",
                    fitMode === 'custom' ? "bg-slate-900 text-white shadow-xs" : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  )}
                  title="Manually adjust scale percentage"
                >
                  <Scaling size={12} />
                  <span>Custom %</span>
                </button>
              </div>
            </div>

            {/* 2. Paper Size & Orientation */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider block">
                Paper Size & Orientation
              </label>
              <div className="flex gap-1.5">
                <select
                  id="select-page-size"
                  value={pageSize}
                  onChange={(e) => setPageSize(e.target.value as PageSize)}
                  className="flex-1 px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none shadow-2xs cursor-pointer focus:ring-1 focus:ring-[#800020]"
                >
                  <option value="a4">A4 (210 × 297 mm)</option>
                  <option value="letter">Letter (8.5 × 11")</option>
                  <option value="legal">Legal (8.5 × 14")</option>
                  <option value="a3">A3 Wide (297 × 420 mm)</option>
                </select>
                <div className="flex rounded-xl border border-slate-200 bg-white p-0.5 shadow-2xs">
                  <button
                    type="button"
                    id="btn-orient-portrait"
                    onClick={() => setOrientation('portrait')}
                    className={cn(
                      "px-2 py-1 text-[10px] font-bold rounded-lg transition-all cursor-pointer uppercase",
                      orientation === 'portrait' ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"
                    )}
                    title="Portrait (Vertical)"
                  >
                    Port
                  </button>
                  <button
                    type="button"
                    id="btn-orient-landscape"
                    onClick={() => setOrientation('landscape')}
                    className={cn(
                      "px-2 py-1 text-[10px] font-bold rounded-lg transition-all cursor-pointer uppercase",
                      orientation === 'landscape' ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"
                    )}
                    title="Landscape (Horizontal) - Great for wide tables"
                  >
                    Land
                  </button>
                </div>
              </div>
            </div>

            {/* 3. Margins */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider block">
                Page Margins
              </label>
              <div className="grid grid-cols-4 gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-2xs">
                {(['none', 'narrow', 'normal', 'wide'] as MarginSize[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMarginSize(m)}
                    className={cn(
                      "py-1 text-[10px] font-bold rounded-lg transition-all cursor-pointer text-center capitalize",
                      marginSize === m ? "bg-[#800020] text-white shadow-xs" : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                    )}
                    title={MARGIN_SPECS[m].label}
                  >
                    {m === 'none' ? '0mm' : m === 'narrow' ? '5mm' : m === 'normal' ? '10mm' : '18mm'}
                  </button>
                ))}
              </div>
            </div>

            {/* 4. Background & Headers Options */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider block">
                Output Style
              </label>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  id="btn-toggle-bg"
                  onClick={() => setIncludeBackgrounds(!includeBackgrounds)}
                  className={cn(
                    "flex-1 px-2 py-1.5 rounded-xl text-[11px] font-bold border transition-all cursor-pointer flex items-center justify-center gap-1 shadow-2xs",
                    includeBackgrounds
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  )}
                  title={includeBackgrounds ? "Preserve all colored badges and background tones" : "Monochrome ink saving"}
                >
                  <CheckCircle2 size={12} className={includeBackgrounds ? "opacity-100" : "opacity-40"} />
                  <span>{includeBackgrounds ? "Full Colors" : "Save Ink"}</span>
                </button>

                <button
                  type="button"
                  id="btn-toggle-header-footer"
                  onClick={() => setIncludeHeaderFooter(!includeHeaderFooter)}
                  className={cn(
                    "flex-1 px-2 py-1.5 rounded-xl text-[11px] font-bold border transition-all cursor-pointer flex items-center justify-center gap-1 shadow-2xs",
                    includeHeaderFooter
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  )}
                  title="Include document title and 'Page X of Y' in PDF header & footer"
                >
                  <FileCheck size={12} className={includeHeaderFooter ? "opacity-100" : "opacity-40"} />
                  <span>Header/Paging</span>
                </button>
              </div>
            </div>
          </div>

          {/* SCALE SLIDER & QUICK ADJUSTMENT BAR */}
          <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200/80">
            <div className="flex items-center gap-3 flex-1 min-w-[280px]">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 shrink-0">
                <Scaling size={14} className="text-[#800020]" />
                <span>Adjust Scale:</span>
                <span className="px-2 py-0.5 rounded-md bg-[#800020]/10 text-[#800020] font-black text-xs min-w-[44px] text-center">
                  {activeScalePercent}%
                </span>
              </div>

              {/* Slider */}
              <input
                type="range"
                min="30"
                max="180"
                step="5"
                value={activeScalePercent}
                onChange={(e) => {
                  setFitMode('custom');
                  setCustomScale(Number(e.target.value));
                }}
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#800020]"
                title="Drag to zoom in or zoom out content"
              />

              {/* Stepper buttons */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  id="btn-scale-minus"
                  onClick={() => {
                    setFitMode('custom');
                    setCustomScale(prev => Math.max(30, (fitMode === 'fit-page' ? autoFit1PagePercent : prev) - 5));
                  }}
                  className="p-1 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                  title="Decrease scale (-5%)"
                >
                  <ZoomOut size={13} />
                </button>
                <button
                  type="button"
                  id="btn-scale-plus"
                  onClick={() => {
                    setFitMode('custom');
                    setCustomScale(prev => Math.min(180, (fitMode === 'fit-page' ? autoFit1PagePercent : prev) + 5));
                  }}
                  className="p-1 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                  title="Increase scale (+5%)"
                >
                  <ZoomIn size={13} />
                </button>
              </div>
            </div>

            {/* Quick Scale Presets */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-bold text-slate-400 uppercase mr-1">Presets:</span>
              {[
                { label: '50%', val: 50 },
                { label: '70%', val: 70 },
                { label: '80%', val: 80 },
                { label: '90%', val: 90 },
                { label: '100%', val: 100 },
                { label: '125%', val: 125 }
              ].map(preset => (
                <button
                  key={preset.val}
                  type="button"
                  onClick={() => {
                    setFitMode('custom');
                    setCustomScale(preset.val);
                  }}
                  className={cn(
                    "px-2 py-0.5 text-[10px] font-bold rounded-md border transition-all cursor-pointer",
                    fitMode === 'custom' && customScale === preset.val
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                  )}
                >
                  {preset.label}
                </button>
              ))}

              <button
                type="button"
                id="btn-auto-fit-preset"
                onClick={handleAutoFitOnePage}
                className={cn(
                  "px-2 py-0.5 text-[10px] font-bold rounded-md border transition-all cursor-pointer flex items-center gap-1",
                  fitMode === 'fit-page'
                    ? "bg-[#800020] text-white border-[#800020]"
                    : "bg-rose-50 text-[#800020] border-rose-200 hover:bg-rose-100"
                )}
                title="Fit to 1 Single Page"
              >
                <Minimize2 size={10} />
                <span>Auto-Fit ({autoFit1PagePercent}%)</span>
              </button>
            </div>
          </div>
        </div>

        {/* PRINTABLE CONTENT LIVE SHEET PREVIEW */}
        {children && (
          <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs bg-slate-100 flex flex-col">
            {/* Real-time Document Status Bar */}
            <div className="px-4 py-2 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 font-bold text-slate-800">
                  <Eye size={14} className="text-[#800020]" />
                  <span>Interactive Sheet Preview</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border",
                    estimatedPages === 1 
                      ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                      : "bg-blue-50 text-blue-700 border-blue-300"
                  )}>
                    {estimatedPages === 1 ? "✓ Fits on 1 Page" : `📄 Estimated: ${estimatedPages} Pages`}
                  </span>
                  <span className="text-[11px] text-slate-500 font-medium hidden sm:inline">
                    Sheet: <strong className="text-slate-800">{PAGE_SPECS[pageSize].name} ({orientation})</strong>
                  </span>
                  <span className="text-[11px] text-slate-500 font-medium hidden md:inline">
                    Printable: <strong className="text-slate-800">{printableWidthMm.toFixed(0)} × {printableHeightMm.toFixed(0)} mm</strong>
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAutoFitOnePage}
                  className="px-2.5 py-1 bg-white border border-slate-200 hover:border-[#800020] text-slate-700 hover:text-[#800020] rounded-lg text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer shadow-2xs"
                  title="Scale to fit on single sheet"
                >
                  <Minimize2 size={12} />
                  <span>Fit 1 Page</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setFitMode('fit-width'); setCustomScale(100); }}
                  className="px-2.5 py-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer shadow-2xs"
                  title="Reset to 100% width"
                >
                  <Maximize2 size={12} />
                  <span>Reset (100%)</span>
                </button>
              </div>
            </div>

            {/* Visual Simulated Paper Sheet Canvas */}
            <div className="p-4 sm:p-6 overflow-auto max-h-[50vh] flex justify-center bg-slate-200/70 custom-scrollbar">
              <div 
                className={cn(
                  "bg-white shadow-xl border border-slate-300 transition-all rounded-xs relative flex flex-col",
                  orientation === 'portrait' ? "w-full max-w-[820px]" : "w-full max-w-[1040px]"
                )}
                style={{
                  padding: `${Math.max(4, marginMm)}mm`,
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.08)'
                }}
              >
                {/* Visual Header Guide if enabled */}
                {includeHeaderFooter && (
                  <div className="flex justify-between items-center text-[9px] text-slate-400 font-mono border-b border-dashed border-slate-200 pb-1.5 mb-2 select-none">
                    <span>{documentTitle}</span>
                    <span>{new Date().toLocaleDateString()}</span>
                  </div>
                )}

                {/* Scaled Content Container */}
                <div 
                  ref={contentRef}
                  className="printable-document bg-white transition-transform origin-top"
                  style={{
                    transform: activeScalePercent !== 100 ? `scale(${activeScalePercent / 100})` : undefined,
                    transformOrigin: 'top center',
                    width: activeScalePercent < 100 ? `${(10000 / activeScalePercent).toFixed(1)}%` : '100%',
                  }}
                >
                  {children}
                </div>

                {/* Visual Footer Guide if enabled */}
                {includeHeaderFooter && (
                  <div className="flex justify-between items-center text-[9px] text-slate-400 font-mono border-t border-dashed border-slate-200 pt-1.5 mt-auto select-none">
                    <span>AccessOne Security Pass Management</span>
                    <span>Page 1 of {estimatedPages}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* BOTTOM ACTION BUTTONS */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-200">
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            <button
              type="button"
              id="btn-export-excel"
              onClick={handleExportToExcel}
              className="h-8 px-3 text-xs font-semibold text-emerald-800 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-all flex items-center gap-1.5 border border-emerald-200 cursor-pointer shadow-2xs"
              title="Export report and applicant roster directly to Excel spreadsheet (.xlsx)"
            >
              <FileSpreadsheet size={13} className="text-emerald-700" />
              <span>Export to Excel (.xlsx)</span>
            </button>
            <button
              type="button"
              id="btn-save-html"
              onClick={handleDownloadHTML}
              className="h-8 px-3 text-xs font-semibold text-slate-700 hover:text-[#800020] bg-white hover:bg-rose-50 rounded-lg transition-all flex items-center gap-1.5 border border-slate-200 cursor-pointer shadow-2xs"
              title="Download standalone HTML report file"
            >
              <Download size={13} />
              <span>Save HTML</span>
            </button>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              id="btn-modal-cancel"
              onClick={onClose}
              className="h-8 px-3.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              id="btn-trigger-print"
              onClick={handleTriggerPrint}
              className="h-8 px-3.5 bg-white border border-slate-300 text-slate-800 hover:bg-slate-50 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
              title="Send to physical printer or system print dialog"
            >
              <Printer size={13} className="text-[#800020]" />
              <span>Print</span>
            </button>
            <button
              type="button"
              id="btn-download-pdf"
              onClick={handleDownloadPDF}
              disabled={isGeneratingPDF}
              className="h-8 px-4 bg-[#800020] text-white rounded-lg text-xs font-bold hover:bg-[#600018] transition-all flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
              title="Download tailored PDF document (.pdf) with selected fitting and scale"
            >
              {isGeneratingPDF ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Generating PDF ({activeScalePercent}%)...</span>
                </>
              ) : (
                <>
                  <FileDown size={13} />
                  <span>Download PDF ({activeScalePercent}%)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}


