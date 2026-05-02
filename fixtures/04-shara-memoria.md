# Memoria Clew

> Local-first developer research memory.

## What it does
MCP server exposing two tools:
- `memoria_recall`
- `memoria_patterns`

## Stack
- Node.js + Express backend
- React + Vite frontend
- Firestore for storage
- LeanMCP for MCP layer
- Claude (with Gemini fallback)

## Setup
1. `npm install`
2. Set `ANTHROPIC_API_KEY` and `FIRESTORE_PROJECT_ID` in `.env`
3. `npm run dev`

85 passing tests cover the deterministic scoring layer.
