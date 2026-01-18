# LLM Chat Integration Plan for Vercel App

## Overview

Add a working AI chat feature with **agentic capabilities** to the web-app that uses OpenRouter API to analyze TripAdvisor reviews, similar to Nomic Atlas Analyst functionality.

The agent can:
- Execute **SQL queries** on the DuckDB database
- Perform **text search** across reviews
- Run **aggregations** (counts, averages, distributions)
- Apply **filters** to narrow down data
- Provide **explainable answers** with data references

---

## Two-Phase Implementation

### Phase 1: Basic RAG Chat (Foundation)
- Context-aware chat using selected reviews
- Simple question → context → LLM → response flow
- Loading states and error handling

### Phase 2: Agentic Tool Use (Advanced)
- LLM can call tools to query data
- Multi-step reasoning with tool execution loop
- Results from tools fed back to LLM for synthesis

---

## Architecture Diagram (Phase 2 - Agent with Tools)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERFACE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────────────────┐    ┌────────────────────────────────┐    │
│   │     EmbeddingAtlas          │    │        Chat Widget             │    │
│   │     Visualization           │    │                                │    │
│   │                             │    │  ┌──────────────────────────┐  │    │
│   │   • 2D point cloud          │    │  │ Message History          │  │    │
│   │   • Selection (lasso/box)   │────│  │ • User messages          │  │    │
│   │   • Hover tooltips          │    │  │ • Assistant responses    │  │    │
│   │                             │    │  └──────────────────────────┘  │    │
│   │   onSelection callback      │    │                                │    │
│   │   returns DataPoint[]       │    │  ┌──────────────────────────┐  │    │
│   └─────────────────────────────┘    │  │ Input + Send Button      │  │    │
│                                      │  └──────────────────────────┘  │    │
│                                      └────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         │ User sends message
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (App.tsx)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. buildReviewContext(selectedPoints)                                      │
│     ├── Extract review text from DataPoint.fields.description              │
│     ├── Extract ratings from DataPoint.fields.Rating                       │
│     ├── Limit to 20 reviews max                                            │
│     └── Calculate average rating                                           │
│                                                                             │
│  2. Build API request                                                       │
│     ├── System message: review context + instructions                      │
│     └── User message: user's question                                      │
│                                                                             │
│  3. POST /api/chat { messages: [...] }                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         │ HTTPS POST
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    VERCEL SERVERLESS FUNCTION (api/chat.ts)                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Environment Variables (secure, server-side only):                         │
│  • OPENROUTER_API_KEY                                                       │
│  • OPENROUTER_MODEL                                                         │
│                                                                             │
│  Process:                                                                   │
│  1. Validate request (POST, has messages array)                            │
│  2. Add Authorization header with API key                                  │
│  3. Forward to OpenRouter API                                              │
│  4. Return { content: "assistant response" }                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         │ HTTPS POST
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OPENROUTER API                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Endpoint: https://openrouter.ai/api/v1/chat/completions                   │
│                                                                             │
│  Model: nvidia/nemotron-3-nano-30b-a3b:free (configurable)                 │
│                                                                             │
│  Request format:                                                            │
│  {                                                                          │
│    "model": "nvidia/nemotron-3-nano-30b-a3b:free",                         │
│    "messages": [                                                            │
│      { "role": "system", "content": "..." },                               │
│      { "role": "user", "content": "..." }                                  │
│    ]                                                                        │
│  }                                                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Files to Create

### 1. `web-app/.env.local`

**Purpose:** Store sensitive API keys for local development (git-ignored)

```env
# OpenRouter API Configuration
# Get your API key from: https://openrouter.ai/keys

OPENROUTER_API_KEY=your_api_key_here
OPENROUTER_MODEL=nvidia/nemotron-3-nano-30b-a3b:free

# Alternative free models you can use:
# - xiaomi/mimo-v2-flash:free
# - deepseek/deepseek-r1-0528:free
# - google/gemma-3-1b-it:free
```

---

### 2. `web-app/api/chat.ts`

**Purpose:** Vercel serverless function that securely proxies LLM requests

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get API key from environment (secure, server-side only)
  const apiKey = process.env.OPENROUTER_API_KEY;
  const defaultModel = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-nano-30b-a3b:free';

  if (!apiKey) {
    return res.status(500).json({ error: 'OpenRouter API key not configured' });
  }

  try {
    const { messages, model }: ChatRequest = req.body;

    // Validate request
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid request: messages array required' });
    }

    // Call OpenRouter API
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': req.headers.referer || req.headers.origin || 'https://localhost',
        'X-Title': 'TripAdvisor Review Atlas'
      },
      body: JSON.stringify({
        model: model || defaultModel,
        messages: messages
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter API error:', response.status, errorText);
      return res.status(response.status).json({
        error: `OpenRouter API error: ${response.statusText}`
      });
    }

    const data = await response.json();
    const assistantMessage = data.choices?.[0]?.message?.content;

    if (!assistantMessage) {
      return res.status(500).json({ error: 'No response from LLM' });
    }

    return res.status(200).json({
      content: assistantMessage,
      model: data.model
    });

  } catch (error) {
    console.error('Chat API error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}
```

**Key Security Features:**
- API key stored in environment variable (never exposed to client)
- Request validation before forwarding
- Error handling without leaking sensitive info

---

### 3. `web-app/vercel.json`

**Purpose:** Configure Vercel deployment settings

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite"
}
```

---

## Files to Modify

### 4. `web-app/src/App.tsx`

**Changes Required:**

#### 4.1 Add new state variables

```typescript
const [isLoading, setIsLoading] = useState(false);
const [chatError, setChatError] = useState<string | null>(null);
```

#### 4.2 Add context builder function

```typescript
/**
 * Build context from selected review points for LLM
 * Extracts review text and ratings, limits to 20 reviews
 */
function buildReviewContext(points: any[]): {
  reviewsText: string;
  count: number;
  avgRating: number;
} {
  // Limit to 20 reviews to avoid token limits
  const reviews = points.slice(0, 20);

  // Build formatted review text
  const reviewsText = reviews.map((p, i) => {
    const rating = p.fields?.Rating ?? 'N/A';
    const description = p.fields?.description ?? p.text ?? 'No description';
    return `Review ${i + 1} (Rating: ${rating}): ${description}`;
  }).join('\n\n');

  // Calculate average rating
  const ratings = reviews
    .map(p => p.fields?.Rating)
    .filter((r): r is number => typeof r === 'number');

  const avgRating = ratings.length > 0
    ? ratings.reduce((a, b) => a + b, 0) / ratings.length
    : 0;

  return { reviewsText, count: points.length, avgRating };
}
```

#### 4.3 Replace handleSend function

```typescript
const handleSend = async () => {
  if (!input.trim() || isLoading) return;

  const userMessage = input.trim();
  setInput('');
  setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
  setIsLoading(true);
  setChatError(null);

  try {
    // Build system message based on selection
    let systemMessage: string;

    if (selectedPoints.length > 0) {
      const { reviewsText, count, avgRating } = buildReviewContext(selectedPoints);

      systemMessage = `You are an AI assistant analyzing TripAdvisor reviews.

Here are the selected reviews to analyze:

${reviewsText}

Total reviews selected: ${count}
Average rating: ${avgRating.toFixed(2)}

Please answer the user's question based on these reviews. Be concise and helpful.`;
    } else {
      systemMessage = `You are an AI assistant helping users explore TripAdvisor hotel reviews.

No specific reviews are currently selected. You can:
- Suggest the user select some points on the visualization to ask questions about specific reviews
- Answer general questions about how to use the tool
- Explain what kinds of insights they can get from the review data`;
    }

    // Call the API
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userMessage }
        ]
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Request failed: ${response.status}`);
    }

    const data = await response.json();
    setMessages(prev => [...prev, { role: 'assistant', content: data.content }]);

  } catch (error) {
    console.error('Chat error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An error occurred';
    setChatError(errorMessage);
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `Sorry, I encountered an error: ${errorMessage}`
    }]);
  } finally {
    setIsLoading(false);
  }
};
```

#### 4.4 Update chat input UI for loading state

```tsx
<div className="chat-input-area">
  <input
    type="text"
    placeholder={isLoading ? "Thinking..." : "Ask about sentiments, topics..."}
    value={input}
    onChange={(e) => setInput(e.target.value)}
    onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleSend()}
    disabled={isLoading}
  />
  <button onClick={handleSend} disabled={isLoading}>
    {isLoading ? (
      <div className="spinner-small" />
    ) : (
      <Send size={18} />
    )}
  </button>
</div>
```

---

### 5. `web-app/vite.config.ts`

**Purpose:** Handle different base paths for GitHub Pages vs Vercel

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Use "/" for Vercel, "/Embedding-Atlas-App-Nomic/" for GitHub Pages
  base: process.env.VERCEL ? "/" : "/Embedding-Atlas-App-Nomic/",
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  plugins: [react()],
  worker: {
    format: "es",
  },
  build: {
    target: "esnext",
  },
  optimizeDeps: {
    exclude: ["embedding-atlas", "@uwdata/mosaic-core", "@duckdb/duckdb-wasm"],
  },
})
```

---

### 6. `web-app/package.json`

**Add to devDependencies:**

```json
{
  "devDependencies": {
    "@vercel/node": "^3.0.0"
  }
}
```

---

### 7. `web-app/src/App.css`

**Add loading spinner styles:**

```css
.spinner-small {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.chat-input-area input:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.chat-input-area button:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
```

---

## System Message Format

The system message sent to the LLM follows the pattern from the Streamlit reference:

```
You are an AI assistant analyzing TripAdvisor reviews.

Here are the selected reviews to analyze:

Review 1 (Rating: 5): The hotel was amazing! Great location, friendly staff...
Review 2 (Rating: 4): Good experience overall. The room was clean but a bit small...
Review 3 (Rating: 3): Average stay. Nothing special but nothing bad either...
[... up to 20 reviews ...]

Total reviews selected: 47
Average rating: 4.20

Please answer the user's question based on these reviews. Be concise and helpful.
```

---

## Data Flow Detail

### Selection → Context Flow

```
1. User draws selection on Atlas (lasso/box)
                    ↓
2. EmbeddingAtlas.onSelection(DataPoint[]) fires
                    ↓
3. DataPoint structure:
   {
     x: number,           // projection_x
     y: number,           // projection_y
     identifier: string,  // __row_index__
     text: string,        // description
     fields: {
       Rating: number,
       description: string,
       projection_x: number,
       projection_y: number,
       neighbors: object
     }
   }
                    ↓
4. setSelectedPoints(selection) updates React state
                    ↓
5. Chat badge shows count: "{selectedPoints.length}"
```

### Chat → Response Flow

```
1. User types question + hits Enter/Send
                    ↓
2. handleSend() called
   - Adds user message to messages[]
   - Sets isLoading = true
                    ↓
3. buildReviewContext(selectedPoints)
   - Extracts fields.description and fields.Rating
   - Formats as "Review N (Rating: X): text"
   - Limits to 20 reviews
   - Calculates average rating
                    ↓
4. fetch('/api/chat', {
     messages: [
       { role: 'system', content: contextualSystemMessage },
       { role: 'user', content: userQuestion }
     ]
   })
                    ↓
5. Vercel serverless function (api/chat.ts)
   - Validates request
   - Adds Authorization header
   - Forwards to OpenRouter
                    ↓
6. OpenRouter processes with nvidia/nemotron model
                    ↓
7. Response flows back through chain
                    ↓
8. setMessages([...prev, { role: 'assistant', content }])
   - Sets isLoading = false
   - UI updates with response
```

---

## Implementation Order

| Step | File | Action | Complexity |
|------|------|--------|------------|
| 1 | `.env.local` | Create with API key placeholder | Simple |
| 2 | `api/chat.ts` | Create serverless function | Medium |
| 3 | `vercel.json` | Create deployment config | Simple |
| 4 | `package.json` | Add @vercel/node dependency | Simple |
| 5 | `vite.config.ts` | Add conditional base path | Simple |
| 6 | `App.tsx` | Add state, context builder, async handleSend | Medium |
| 7 | `App.css` | Add spinner styles | Simple |

---

## Local Development

### Option 1: Vercel CLI (Recommended)

```bash
# Install Vercel CLI globally
npm i -g vercel

# Navigate to web-app
cd web-app

# Run local dev with serverless functions
vercel dev
```

This runs both Vite dev server AND serverless functions locally.

### Option 2: Vite only (API won't work)

```bash
cd web-app
npm run dev
```

Note: `/api/chat` endpoint won't work - you'll see network errors.

---

## Vercel Deployment Steps

1. **Push code to GitHub**

2. **Import project in Vercel**
   - Go to https://vercel.com/new
   - Import your repository

3. **Configure project settings**
   - Root Directory: `web-app`
   - Framework Preset: Vite
   - Build Command: `npm run build`
   - Output Directory: `dist`

4. **Add environment variables**
   - `OPENROUTER_API_KEY`: Your OpenRouter API key
   - `OPENROUTER_MODEL`: `nvidia/nemotron-3-nano-30b-a3b:free`

5. **Deploy**

---

## Verification Checklist

### Local Testing
- [ ] `vercel dev` starts without errors
- [ ] Atlas visualization loads with data
- [ ] Can select points (lasso/box selection)
- [ ] Selection badge updates with count
- [ ] Sending message shows loading spinner
- [ ] Response appears in chat
- [ ] Error handling works (disconnect network, test)

### Vercel Deployment
- [ ] Preview deployment builds successfully
- [ ] Environment variables configured
- [ ] `/api/chat` endpoint responds
- [ ] Full chat flow works in production
- [ ] No API key exposed in client bundle

---

## Potential Issues & Solutions

| Issue | Solution |
|-------|----------|
| `selectedPoints[0].fields` is undefined | Fall back to `p.text` for description; may need to query DuckDB |
| CORS errors in local dev | Use `vercel dev` instead of `npm run dev` |
| API key not working | Check Vercel dashboard env vars; ensure no quotes |
| Rate limiting from OpenRouter | Add retry logic or user-friendly message |
| Large selection causes timeout | Already limited to 20 reviews; could reduce further |
| Vite base path wrong | Check `VERCEL` env var is set in Vercel |

---

## Tech Stack Summary

| Component | Technology |
|-----------|------------|
| Frontend | React 19 + TypeScript |
| Build Tool | Vite 7 |
| Visualization | embedding-atlas (Apple) |
| Data Engine | DuckDB-WASM + Mosaic |
| Backend | Vercel Serverless Functions |
| LLM Provider | OpenRouter API |
| Default Model | nvidia/nemotron-3-nano-30b-a3b:free |

---

# Phase 2: Agent with Tool Use

## Agent Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AGENT LOOP                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   User Question                                                             │
│        │                                                                    │
│        ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────┐      │
│   │                         LLM (OpenRouter)                         │      │
│   │                                                                  │      │
│   │   System Prompt:                                                │      │
│   │   - You are a data analyst for TripAdvisor reviews             │      │
│   │   - You have access to tools to query and analyze data         │      │
│   │   - Use tools to gather information before answering           │      │
│   │                                                                  │      │
│   │   Available Tools:                                              │      │
│   │   1. sql_query - Execute SQL on reviews table                  │      │
│   │   2. text_search - Search reviews by keyword                   │      │
│   │   3. get_stats - Get column statistics                         │      │
│   │   4. get_sample - Get sample reviews                           │      │
│   │                                                                  │      │
│   └─────────────────────────────────────────────────────────────────┘      │
│        │                                                                    │
│        ▼                                                                    │
│   ┌─────────────┐    No     ┌─────────────────────────────────────┐        │
│   │ Tool Call?  │──────────▶│  Return Final Response to User      │        │
│   └─────────────┘           └─────────────────────────────────────┘        │
│        │ Yes                                                                │
│        ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────┐      │
│   │                    TOOL EXECUTOR (Frontend)                      │      │
│   │                                                                  │      │
│   │   Runs in browser using DuckDB-WASM:                           │      │
│   │                                                                  │      │
│   │   sql_query(sql)     → coordinator.query(sql)                  │      │
│   │   text_search(term)  → SELECT WHERE description ILIKE '%term%' │      │
│   │   get_stats(column)  → SELECT COUNT, AVG, MIN, MAX             │      │
│   │   get_sample(n)      → SELECT * LIMIT n                        │      │
│   │                                                                  │      │
│   └─────────────────────────────────────────────────────────────────┘      │
│        │                                                                    │
│        │ Tool Results                                                       │
│        │                                                                    │
│        └──────────────────────────────▶ Back to LLM (loop)                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tool Definitions

### 1. `sql_query` - Execute SQL Query

```typescript
{
  name: "sql_query",
  description: "Execute a SQL query on the reviews table. The table 'reviews' has columns: __row_index__ (int), description (text), Rating (int 1-5), projection_x (float), projection_y (float), neighbors (json).",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "SQL query to execute. Use SELECT only. Example: SELECT Rating, COUNT(*) FROM reviews GROUP BY Rating"
      }
    },
    required: ["query"]
  }
}
```

### 2. `text_search` - Search Reviews by Keyword

```typescript
{
  name: "text_search",
  description: "Search for reviews containing specific keywords or phrases.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search term or phrase to find in review descriptions"
      },
      limit: {
        type: "number",
        description: "Maximum number of results (default: 10)"
      }
    },
    required: ["query"]
  }
}
```

### 3. `get_stats` - Get Column Statistics

```typescript
{
  name: "get_stats",
  description: "Get statistics for the reviews data: total count, rating distribution, etc.",
  parameters: {
    type: "object",
    properties: {
      include_rating_distribution: {
        type: "boolean",
        description: "Include breakdown by rating (1-5 stars)"
      }
    }
  }
}
```

### 4. `get_sample` - Get Sample Reviews

```typescript
{
  name: "get_sample",
  description: "Get a random sample of reviews to understand the data.",
  parameters: {
    type: "object",
    properties: {
      count: {
        type: "number",
        description: "Number of sample reviews (default: 5, max: 20)"
      },
      rating_filter: {
        type: "number",
        description: "Optional: only get reviews with this rating (1-5)"
      }
    }
  }
}
```

---

## Agent System Prompt

```
You are an AI data analyst assistant for exploring TripAdvisor hotel reviews.

You have access to a database of hotel reviews with the following schema:

TABLE: reviews
- __row_index__: Unique identifier (integer)
- description: Full review text (string)
- Rating: Star rating from 1-5 (integer)
- projection_x, projection_y: 2D coordinates for visualization (float)
- neighbors: Pre-computed similar reviews (json)

AVAILABLE TOOLS:
1. sql_query: Execute SQL SELECT queries on the reviews table
2. text_search: Search reviews containing specific keywords
3. get_stats: Get overall statistics and rating distribution
4. get_sample: Get sample reviews to understand the data

INSTRUCTIONS:
- Always use tools to gather data before answering questions
- For quantitative questions (counts, averages), use sql_query
- For finding specific topics or themes, use text_search
- Show your reasoning by explaining what tools you're using and why
- Cite specific reviews or statistics in your answers
- Be concise but thorough

EXAMPLES:
- "What do people say about breakfast?" → Use text_search("breakfast")
- "What's the average rating?" → Use sql_query("SELECT AVG(Rating) FROM reviews")
- "How many 5-star reviews?" → Use sql_query("SELECT COUNT(*) FROM reviews WHERE Rating = 5")
- "Show me some negative reviews" → Use get_sample with rating_filter=1 or 2
```

---

## API Endpoint with Tool Support

### `web-app/api/agent.ts`

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// Tool definitions for OpenRouter
const TOOLS = [
  {
    type: "function",
    function: {
      name: "sql_query",
      description: "Execute a SQL SELECT query on the reviews table.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "SQL query to execute (SELECT only)"
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "text_search",
      description: "Search for reviews containing keywords.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search term" },
          limit: { type: "number", description: "Max results (default 10)" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_stats",
      description: "Get statistics for the reviews dataset.",
      parameters: {
        type: "object",
        properties: {
          include_rating_distribution: { type: "boolean" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_sample",
      description: "Get sample reviews.",
      parameters: {
        type: "object",
        properties: {
          count: { type: "number", description: "Number of samples (max 20)" },
          rating_filter: { type: "number", description: "Filter by rating 1-5" }
        }
      }
    }
  }
];

const SYSTEM_PROMPT = `You are an AI data analyst for TripAdvisor hotel reviews.
...` // Full prompt from above

interface AgentRequest {
  messages: Array<{role: string, content: string}>;
  toolResults?: Array<{name: string, result: any}>;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-nano-30b-a3b:free';

  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const { messages, toolResults }: AgentRequest = req.body;

    // Build messages array
    const apiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages
    ];

    // If we have tool results, add them
    if (toolResults && toolResults.length > 0) {
      for (const result of toolResults) {
        apiMessages.push({
          role: 'tool',
          content: JSON.stringify(result.result),
          tool_call_id: result.name
        });
      }
    }

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': req.headers.referer || 'https://localhost',
        'X-Title': 'TripAdvisor Review Atlas Agent'
      },
      body: JSON.stringify({
        model,
        messages: apiMessages,
        tools: TOOLS,
        tool_choice: 'auto'
      })
    });

    if (!response.ok) {
      const error = await response.text();
      return res.status(response.status).json({ error });
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    // Check if LLM wants to call tools
    if (choice?.message?.tool_calls) {
      return res.status(200).json({
        type: 'tool_calls',
        tool_calls: choice.message.tool_calls,
        message: choice.message
      });
    }

    // Final response
    return res.status(200).json({
      type: 'response',
      content: choice?.message?.content || 'No response'
    });

  } catch (error) {
    console.error('Agent error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal error'
    });
  }
}
```

---

## Frontend Tool Executor

### `web-app/src/tools/toolExecutor.ts`

```typescript
import { Coordinator } from '@uwdata/mosaic-core';

export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  name: string;
  call_id: string;
  result: any;
  error?: string;
}

export class ToolExecutor {
  constructor(private coordinator: Coordinator) {}

  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const { name, arguments: argsJson } = toolCall.function;
    const args = JSON.parse(argsJson);

    try {
      switch (name) {
        case 'sql_query':
          return await this.sqlQuery(toolCall.id, args.query);

        case 'text_search':
          return await this.textSearch(toolCall.id, args.query, args.limit);

        case 'get_stats':
          return await this.getStats(toolCall.id, args.include_rating_distribution);

        case 'get_sample':
          return await this.getSample(toolCall.id, args.count, args.rating_filter);

        default:
          return {
            name,
            call_id: toolCall.id,
            result: null,
            error: `Unknown tool: ${name}`
          };
      }
    } catch (error) {
      return {
        name,
        call_id: toolCall.id,
        result: null,
        error: error instanceof Error ? error.message : 'Tool execution failed'
      };
    }
  }

  private async sqlQuery(callId: string, query: string): Promise<ToolResult> {
    // Security: Only allow SELECT queries
    const normalized = query.trim().toUpperCase();
    if (!normalized.startsWith('SELECT')) {
      return {
        name: 'sql_query',
        call_id: callId,
        result: null,
        error: 'Only SELECT queries are allowed'
      };
    }

    const result = await this.coordinator.query(query);
    const rows = result.toArray().slice(0, 100); // Limit results

    return {
      name: 'sql_query',
      call_id: callId,
      result: {
        columns: Object.keys(rows[0] || {}),
        rows: rows,
        row_count: rows.length
      }
    };
  }

  private async textSearch(
    callId: string,
    searchQuery: string,
    limit: number = 10
  ): Promise<ToolResult> {
    const sql = `
      SELECT __row_index__, Rating, description
      FROM reviews
      WHERE description ILIKE '%${searchQuery.replace(/'/g, "''")}%'
      LIMIT ${Math.min(limit, 50)}
    `;

    const result = await this.coordinator.query(sql);
    const rows = result.toArray();

    return {
      name: 'text_search',
      call_id: callId,
      result: {
        query: searchQuery,
        matches: rows.length,
        reviews: rows.map(r => ({
          id: r.__row_index__,
          rating: r.Rating,
          excerpt: r.description.substring(0, 200) + '...'
        }))
      }
    };
  }

  private async getStats(
    callId: string,
    includeDistribution: boolean = true
  ): Promise<ToolResult> {
    const countResult = await this.coordinator.query(
      'SELECT COUNT(*) as total, AVG(Rating) as avg_rating FROM reviews'
    );
    const stats = countResult.toArray()[0];

    let distribution = null;
    if (includeDistribution) {
      const distResult = await this.coordinator.query(
        'SELECT Rating, COUNT(*) as count FROM reviews GROUP BY Rating ORDER BY Rating'
      );
      distribution = distResult.toArray();
    }

    return {
      name: 'get_stats',
      call_id: callId,
      result: {
        total_reviews: stats.total,
        average_rating: Number(stats.avg_rating).toFixed(2),
        rating_distribution: distribution
      }
    };
  }

  private async getSample(
    callId: string,
    count: number = 5,
    ratingFilter?: number
  ): Promise<ToolResult> {
    let sql = 'SELECT __row_index__, Rating, description FROM reviews';
    if (ratingFilter && ratingFilter >= 1 && ratingFilter <= 5) {
      sql += ` WHERE Rating = ${ratingFilter}`;
    }
    sql += ` ORDER BY RANDOM() LIMIT ${Math.min(count, 20)}`;

    const result = await this.coordinator.query(sql);
    const rows = result.toArray();

    return {
      name: 'get_sample',
      call_id: callId,
      result: {
        sample_size: rows.length,
        filter: ratingFilter ? `Rating = ${ratingFilter}` : 'none',
        reviews: rows.map(r => ({
          id: r.__row_index__,
          rating: r.Rating,
          text: r.description
        }))
      }
    };
  }
}
```

---

## Agent Chat Hook

### `web-app/src/hooks/useAgentChat.ts`

```typescript
import { useState, useCallback } from 'react';
import { Coordinator } from '@uwdata/mosaic-core';
import { ToolExecutor, ToolCall, ToolResult } from '../tools/toolExecutor';

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

interface AgentState {
  messages: Message[];
  isLoading: boolean;
  isExecutingTools: boolean;
  currentStep: string;
  error: string | null;
}

export function useAgentChat(coordinator: Coordinator) {
  const [state, setState] = useState<AgentState>({
    messages: [{
      role: 'assistant',
      content: 'Hello! I can analyze the TripAdvisor reviews for you. Ask me anything - I\'ll query the data to find answers.'
    }],
    isLoading: false,
    isExecutingTools: false,
    currentStep: '',
    error: null
  });

  const toolExecutor = new ToolExecutor(coordinator);

  const sendMessage = useCallback(async (userMessage: string) => {
    if (!userMessage.trim()) return;

    // Add user message
    setState(prev => ({
      ...prev,
      messages: [...prev.messages, { role: 'user', content: userMessage }],
      isLoading: true,
      error: null,
      currentStep: 'Thinking...'
    }));

    try {
      let conversationMessages = [
        ...state.messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage }
      ];

      let maxIterations = 5; // Prevent infinite loops
      let iteration = 0;

      while (iteration < maxIterations) {
        iteration++;

        // Call agent API
        const response = await fetch('/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: conversationMessages })
        });

        if (!response.ok) {
          throw new Error('Agent request failed');
        }

        const data = await response.json();

        // If agent wants to call tools
        if (data.type === 'tool_calls' && data.tool_calls) {
          setState(prev => ({
            ...prev,
            isExecutingTools: true,
            currentStep: `Executing ${data.tool_calls.length} tool(s)...`
          }));

          // Execute tools
          const toolResults: ToolResult[] = [];
          for (const toolCall of data.tool_calls) {
            setState(prev => ({
              ...prev,
              currentStep: `Running: ${toolCall.function.name}...`
            }));

            const result = await toolExecutor.execute(toolCall);
            toolResults.push(result);
          }

          // Add tool results to conversation
          conversationMessages.push({
            role: 'assistant',
            content: '',
            tool_calls: data.tool_calls
          });

          for (const result of toolResults) {
            conversationMessages.push({
              role: 'tool',
              content: JSON.stringify(result.result),
              tool_call_id: result.call_id
            });
          }

          // Continue the loop to get final response
          continue;
        }

        // Final response from agent
        setState(prev => ({
          ...prev,
          messages: [...prev.messages, {
            role: 'assistant',
            content: data.content
          }],
          isLoading: false,
          isExecutingTools: false,
          currentStep: ''
        }));

        return;
      }

      throw new Error('Max iterations reached');

    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        isExecutingTools: false,
        currentStep: '',
        error: error instanceof Error ? error.message : 'An error occurred',
        messages: [...prev.messages, {
          role: 'assistant',
          content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      }));
    }
  }, [state.messages, toolExecutor]);

  const clearChat = useCallback(() => {
    setState({
      messages: [{
        role: 'assistant',
        content: 'Chat cleared. Ask me anything about the reviews!'
      }],
      isLoading: false,
      isExecutingTools: false,
      currentStep: '',
      error: null
    });
  }, []);

  return {
    ...state,
    sendMessage,
    clearChat
  };
}
```

---

## Updated Chat UI with Tool Status

```tsx
// In App.tsx chat window section

{isChatOpen && (
  <div className="chat-window">
    <div className="chat-header">
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <h3>Review Analyst</h3>
        {selectedPoints.length > 0 && (
          <span className="selection-info">
            {selectedPoints.length} items selected
          </span>
        )}
      </div>
      <div className="header-actions">
        <button onClick={clearChat} title="Clear chat">
          <Trash2 size={16} />
        </button>
        <button onClick={() => setIsChatOpen(false)}>
          <X size={20} />
        </button>
      </div>
    </div>

    <div className="chat-messages">
      {messages.map((msg, i) => (
        <div key={i} className={`message ${msg.role}`}>
          {msg.content}
        </div>
      ))}

      {/* Loading/Tool Status */}
      {isLoading && (
        <div className="message assistant loading">
          <div className="typing-indicator">
            <span></span><span></span><span></span>
          </div>
          {currentStep && (
            <div className="step-indicator">{currentStep}</div>
          )}
        </div>
      )}
    </div>

    <div className="chat-input-area">
      <input
        type="text"
        placeholder={isLoading ? "Processing..." : "Ask about the reviews..."}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !isLoading && sendMessage(input)}
        disabled={isLoading}
      />
      <button onClick={() => sendMessage(input)} disabled={isLoading}>
        {isLoading ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
      </button>
    </div>
  </div>
)}
```

---

## Additional CSS for Agent UI

```css
/* Tool execution status */
.step-indicator {
  font-size: 11px;
  color: #60a5fa;
  margin-top: 4px;
  font-style: italic;
}

.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 8px 0;
}

.typing-indicator span {
  width: 8px;
  height: 8px;
  background: #60a5fa;
  border-radius: 50%;
  animation: bounce 1.4s infinite ease-in-out;
}

.typing-indicator span:nth-child(1) { animation-delay: -0.32s; }
.typing-indicator span:nth-child(2) { animation-delay: -0.16s; }

@keyframes bounce {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}

.spin {
  animation: spin 1s linear infinite;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.header-actions button {
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  padding: 4px;
}

.header-actions button:hover {
  color: #f8fafc;
}
```

---

## Phase 2 Implementation Order

| Step | File | Action | Complexity |
|------|------|--------|------------|
| 1 | `api/agent.ts` | Create agent API with tool definitions | High |
| 2 | `src/tools/toolExecutor.ts` | Create tool executor class | High |
| 3 | `src/hooks/useAgentChat.ts` | Create agent chat hook | High |
| 4 | `src/App.tsx` | Integrate agent hook and update UI | Medium |
| 5 | `src/App.css` | Add agent-specific styles | Simple |

---

## Example Conversations

### Example 1: Statistical Query

**User:** "What's the rating distribution?"

**Agent thinking:**
```
I'll use get_stats to get the rating distribution.
```

**Tool call:** `get_stats({ include_rating_distribution: true })`

**Tool result:**
```json
{
  "total_reviews": 20491,
  "average_rating": 4.12,
  "rating_distribution": [
    {"Rating": 1, "count": 1203},
    {"Rating": 2, "count": 1456},
    {"Rating": 3, "count": 2891},
    {"Rating": 4, "count": 5234},
    {"Rating": 5, "count": 9707}
  ]
}
```

**Agent response:**
> The dataset contains **20,491 reviews** with an average rating of **4.12 stars**.
>
> Rating distribution:
> - ⭐⭐⭐⭐⭐ (5 stars): 9,707 reviews (47%)
> - ⭐⭐⭐⭐ (4 stars): 5,234 reviews (26%)
> - ⭐⭐⭐ (3 stars): 2,891 reviews (14%)
> - ⭐⭐ (2 stars): 1,456 reviews (7%)
> - ⭐ (1 star): 1,203 reviews (6%)
>
> The reviews skew positive, with 73% being 4 or 5 stars.

### Example 2: Topic Search

**User:** "What do people complain about regarding noise?"

**Agent thinking:**
```
I'll search for reviews mentioning "noise" to find complaints.
```

**Tool call:** `text_search({ query: "noise", limit: 15 })`

**Tool result:** (15 reviews mentioning noise)

**Agent response:**
> I found **15 reviews** mentioning noise concerns. Common complaints include:
>
> 1. **Street noise** - Several guests mention traffic and city sounds
> 2. **Thin walls** - Complaints about hearing neighbors
> 3. **AC units** - Some mention loud air conditioning
>
> Example review (Rating: 2):
> > "The room was nice but the noise from the street was unbearable. Could barely sleep..."

---

## Model Compatibility Note

**Important:** Not all free models on OpenRouter support function calling/tools.

Models that typically support tools:
- `openai/gpt-4o-mini` (not free)
- `anthropic/claude-3-haiku` (not free)
- Some Mistral models

For the free `nvidia/nemotron-3-nano-30b-a3b:free` model, tool support may be limited. Alternative approaches if tools don't work:

1. **Structured output parsing**: Ask the model to respond in JSON format indicating what actions to take
2. **ReAct-style prompting**: Use text-based "Action:" and "Observation:" format
3. **Upgrade to a paid model** with proper tool support when productizing

---

## Security Considerations

1. **SQL Injection Prevention**
   - Only allow SELECT queries
   - Validate and sanitize inputs
   - Use parameterized queries where possible

2. **Rate Limiting**
   - Limit tool executions per request (max 5 iterations)
   - Implement API rate limiting on Vercel

3. **Data Exposure**
   - Limit result sizes (max 100 rows)
   - Truncate long text in responses

4. **Cost Control**
   - Monitor API usage
   - Set billing alerts on OpenRouter
