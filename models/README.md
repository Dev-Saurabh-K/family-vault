# FamilyVault Models Directory

This directory stores offline GGUF neural models bundled with the application.

Target model:
`gemma-4-e2b` (Multimodal GGUF / Vision Model)

FamilyVault leverages Gemma-4-E2B's multimodal capabilities as the primary engine for document image processing, visual layout understanding, and OCR extraction (with Tesseract.js maintained strictly as a local fallback on model failure).

When FamilyVault starts (both in development and in the installed application distribution), it automatically scans this directory and launches the model on `127.0.0.1:18432`.
