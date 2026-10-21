# M3 live desktop MCP scenario

```json
{
  "result": {
    "transport": "real stdio process → SQLite → ChangeFeed → Tauri event → React",
    "created": "JB7-33",
    "claimed": "JB7-7",
    "moved": "JB7-1",
    "arrivalObservedByMs": 241,
    "frames": [
      {
        "frame": 1,
        "sampledAtMs": 0,
        "compositorFrameAtMs": -3
      },
      {
        "frame": 2,
        "sampledAtMs": 206,
        "compositorFrameAtMs": 112
      },
      {
        "frame": 3,
        "sampledAtMs": 411,
        "compositorFrameAtMs": 379
      },
      {
        "frame": 4,
        "sampledAtMs": 599,
        "compositorFrameAtMs": 574
      },
      {
        "frame": 5,
        "sampledAtMs": 801,
        "compositorFrameAtMs": 793
      },
      {
        "frame": 6,
        "sampledAtMs": 1002,
        "compositorFrameAtMs": 977
      }
    ],
    "humanActorVerified": true,
    "themePersistsAfterReload": true,
    "pageErrors": []
  },
  "calls": [
    {
      "name": "create_task",
      "arguments": {
        "title": "Add a warm lantern flicker",
        "status": "review",
        "tags": [
          "polish"
        ],
        "priority": "high",
        "description": "A subtle, cozy glow that agents and humans can review together."
      },
      "response": [
        {
          "type": "text",
          "text": "Created JB7-33 'Add a warm lantern flicker' in review."
        }
      ],
      "key": "JB7-33"
    },
    {
      "name": "claim_task",
      "arguments": {
        "key": "JB7-7"
      },
      "response": [
        {
          "type": "text",
          "text": "Claimed JB7-7 'Player movement: coyote time & jump buffer'."
        }
      ],
      "key": "JB7-7"
    },
    {
      "name": "move_task",
      "arguments": {
        "key": "JB7-1",
        "status": "review",
        "beforeKey": "JB7-22"
      },
      "response": [
        {
          "type": "text",
          "text": "Moved JB7-1 to review."
        }
      ],
      "key": "JB7-1"
    },
    {
      "name": "move_task",
      "arguments": {
        "key": "JB7-33",
        "status": "review",
        "beforeKey": "JB7-1"
      },
      "response": [
        {
          "type": "text",
          "text": "Moved JB7-33 to review."
        }
      ],
      "key": "JB7-33"
    }
  ]
}
```
