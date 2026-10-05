# FamilyVault Models Directory

This directory stores offline GGUF neural models bundled with the application.

Target model:
`gemma-4-e2b` (Multimodal GGUF / Vision Model)

Gemma-4-E2B is used for local text-based metadata reasoning and grounded Q&A. It is not currently used for document image processing or OCR. Image and scanned-PDF OCR use PaddleOCR first and fall back to local Tesseract.js if PaddleOCR fails or returns no usable text.

When FamilyVault starts (both in development and in the installed application distribution), it automatically scans this directory and launches the model on `127.0.0.1:18432`.
