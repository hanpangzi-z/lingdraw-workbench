export const importLimits = {
  pdfMaxPages: 100,
  pptMaxSlides: 100,
  wordMaxBytes: 50 * 1024 * 1024,
  primaryMaxBytes: 100 * 1024 * 1024,
  supportingMaxFiles: 500,
  ocrTextDensityThreshold: 0.00035,
} as const;

export const supportedPrimaryExtensions = ["xlsx", "xls", "pdf", "docx", "pptx"] as const;
export const rejectedMacroExtensions = ["docm", "pptm", "xlsm"] as const;
