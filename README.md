# microGPT

A complete GPT in ~200 lines of pure Python. No dependencies. No magic.

```
python3 microgpt.py
```

## What's inside

**`microgpt.py`** — the full algorithm, nothing else:
- Custom autograd engine (`Value`) — scalars, chain rule, backprop
- GPT-2-style transformer — token/pos embeddings, multi-head attention, MLP, RMSNorm
- Adam optimizer with cosine LR decay
- Training loop + text generation

**`microgpt_explorer.html`** — interactive code explorer with an AI chat panel. Click any line, ask questions, get visualizations.

```
make preview   # serves the explorer at localhost:8000
```

## Goal

Make every line of a transformer legible. Inspired by [@karpathy](https://github.com/karpathy).
