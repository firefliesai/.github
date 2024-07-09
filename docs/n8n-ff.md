## N8n

N8n is responsible for:

- Initiate summary process;
- Handle AI Apps.

### How Summary Is Processed?

```mermaid
  sequenceDiagram
    participant audio as audio-ff
    participant n8n as n8n-ff
    participant codex as codex-ff
    participant meeting as meeting-service
    participant storage as s3

    audio->>n8n: Transcription Completed
    n8n->>codex: Generate Summary
    codex->>n8n: Summary Generated
    n8n->>meeting: Save Summary
    meeting->>storage: Add To Artifacts
```

#### Additional Resources

- [How Meeting Is Transcribed?](./audio.md)
- [How Meeting Data Is Stored?](./storage.md)