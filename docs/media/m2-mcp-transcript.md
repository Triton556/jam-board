# M2 MCP stdio transcript

Recorded: 2026-10-19T07:13:28.448Z

Binary: `<checkout>\target/debug/jam-board-mcp.exe`

JAM_BOARD_DATA_DIR: `<checkout>\.dev-data`

Real process, real SQLite database. Responses below are shortened; no protocol frames are simulated.

## Actual desktop shell

```json
{
  "title": "Jam Board",
  "theme": "light",
  "paper": "rgb(247, 241, 230)",
  "bodyFont": "\"Manrope Variable\", sans-serif",
  "headingFont": "\"Fraunces Variable\", serif",
  "fontReady": "loaded",
  "viewport": [
    1360,
    860
  ]
}
```

## initialize

```json
{
  "request": {
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-06-18",
      "capabilities": {},
      "clientInfo": {
        "name": "codex-m2-manual-client",
        "version": "1.0"
      }
    }
  },
  "response": {
    "protocolVersion": "2025-06-18",
    "capabilities": {
      "prompts": {},
      "resources": {},
      "tools": {}
    },
    "serverInfo": {
      "name": "jam-board",
      "version": "0.1.0"
    },
    "instructions": "Plan your game jam with your AI teammates. Use task keys such as JB-12; claim before working, comment with results, then move to review."
  }
}
```

## tools/list

```json
{
  "request": {
    "method": "tools/list",
    "params": {}
  },
  "response": {
    "tools": [
      "get_board",
      "list_tasks",
      "get_task",
      "create_task",
      "update_task",
      "move_task",
      "claim_task",
      "release_task",
      "add_comment",
      "archive_task",
      "list_members",
      "list_assets"
    ]
  }
}
```

## tools/call · create_task

```json
{
  "request": {
    "method": "tools/call",
    "params": {
      "name": "create_task",
      "arguments": {
        "title": "Add jump buffer",
        "description": "Allow a jump press just before landing.",
        "priority": "high",
        "tags": [
          "gameplay"
        ],
        "idempotencyKey": "m2-manual-1792394008464"
      }
    }
  },
  "response": {
    "isError": false,
    "content": [
      {
        "type": "text",
        "text": "Created JB-34 'Add jump buffer' in todo."
      }
    ],
    "structuredContent": {
      "key": "JB-34",
      "title": "Add jump buffer",
      "status": "todo",
      "tags": [
        "gameplay"
      ],
      "comments": [],
      "activityCount": 1
    }
  }
}
```

## tools/call · list_tasks

```json
{
  "request": {
    "method": "tools/call",
    "params": {
      "name": "list_tasks",
      "arguments": {
        "query": "Add jump buffer"
      }
    }
  },
  "response": {
    "isError": false,
    "content": [
      {
        "type": "text",
        "text": "Found 2 tasks."
      }
    ],
    "structuredContent": {
      "tasks": [
        {
          "key": "JB-33",
          "title": "Add jump buffer",
          "status": "review"
        },
        {
          "key": "JB-34",
          "title": "Add jump buffer",
          "status": "todo"
        }
      ]
    }
  }
}
```

## tools/call · claim_task

```json
{
  "request": {
    "method": "tools/call",
    "params": {
      "name": "claim_task",
      "arguments": {
        "key": "JB-34"
      }
    }
  },
  "response": {
    "isError": false,
    "content": [
      {
        "type": "text",
        "text": "Claimed JB-34 'Add jump buffer'."
      }
    ],
    "structuredContent": {
      "key": "JB-34",
      "title": "Add jump buffer",
      "status": "in_progress",
      "tags": [
        "gameplay"
      ],
      "comments": [],
      "activityCount": 2
    }
  }
}
```

## tools/call · move_task

```json
{
  "request": {
    "method": "tools/call",
    "params": {
      "name": "move_task",
      "arguments": {
        "key": "JB-34",
        "status": "review"
      }
    }
  },
  "response": {
    "isError": false,
    "content": [
      {
        "type": "text",
        "text": "Moved JB-34 to review."
      }
    ],
    "structuredContent": {
      "key": "JB-34",
      "title": "Add jump buffer",
      "status": "review",
      "tags": [
        "gameplay"
      ]
    }
  }
}
```

## tools/call · add_comment

```json
{
  "request": {
    "method": "tools/call",
    "params": {
      "name": "add_comment",
      "arguments": {
        "key": "JB-34",
        "body": "Jump buffer implemented; checked landing and repeated input."
      }
    }
  },
  "response": {
    "isError": false,
    "content": [
      {
        "type": "text",
        "text": "Completed add_comment ."
      }
    ],
    "structuredContent": {
      "bodyMd": "Jump buffer implemented; checked landing and repeated input."
    }
  }
}
```

## tools/call · get_task

```json
{
  "request": {
    "method": "tools/call",
    "params": {
      "name": "get_task",
      "arguments": {
        "key": "JB-34"
      }
    }
  },
  "response": {
    "isError": false,
    "content": [
      {
        "type": "text",
        "text": "JB-34 · Add jump buffer"
      }
    ],
    "structuredContent": {
      "key": "JB-34",
      "title": "Add jump buffer",
      "status": "review",
      "tags": [
        "gameplay"
      ],
      "comments": [
        {
          "bodyMd": "Jump buffer implemented; checked landing and repeated input."
        }
      ],
      "activityCount": 4
    }
  }
}
```

Actual desktop console received `board-changed` 81 ms after the create request began.
