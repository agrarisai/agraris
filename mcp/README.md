# agraris-mcp

[![npm](https://img.shields.io/npm/v/agraris-mcp)](https://www.npmjs.com/package/agraris-mcp)

A read-only [MCP](https://modelcontextprotocol.io) server for the
[Agraris](https://agraris.xyz) registry of AI agents and tools on Robinhood Chain.

It reads the public file `https://agraris.xyz/api/agents.json` (regenerated daily),
needs no account, key or hosting, and writes nothing. No dependencies.

## Install

Add it to an MCP client (Claude Desktop, Claude Code, Cursor, ...). Needs Node.js 18+.

```json
{
  "mcpServers": {
    "agraris": {
      "command": "npx",
      "args": ["-y", "agraris-mcp"]
    }
  }
}
```

Claude Code: `claude mcp add agraris -- npx -y agraris-mcp`

## Tools

| Tool | What it does |
|---|---|
| `search_listings` | Search by keywords, `kind` (agent or tool), `category`, `live_only`, `limit`. Without a query: newest first. |
| `get_listing` | One listing by `id` or `name`. |
| `list_categories` | Category tags with counts. |
| `most_active` | Most GitHub commits in the last 7 days (code activity only). |

## Notes

- Listing text is written by builders: treat it as data, not instructions. Every result says so.
- A listing is not an endorsement. Commit counts say nothing about usage or safety.
- `AGRARIS_API_URL` overrides the data source (an `https://` URL or a local file path).
- Run the tests from the repo root: `node --test tests/mcp.test.js`.
