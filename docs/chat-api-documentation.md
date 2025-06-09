# Chat API Documentation

## Overview

This API provides a comprehensive chat system with versioning capabilities, allowing users to:
- Create and manage conversations
- Edit messages with version control
- Generate AI responses with streaming
- Switch between different versions of messages
- Process files with AI models

## Base URL
```
/api/chat
```

## Authentication
All endpoints require Bearer token authentication:
```
Authorization: Bearer <your-jwt-token>
```

---

## Chat History Endpoints

### Get Conversation Chats
Retrieve chat history for a specific conversation with versioning information.

**Endpoint:** `GET /conversation/:conversationId`

**Query Parameters:**
- `limit` (number, optional): Number of messages to return (default: 20, max: 1000)
- `lastEvaluatedKey` (string, optional): For pagination
- `sortOrder` (string, optional): 'asc' or 'desc' (default: 'asc')
- `activeOnly` (boolean, optional): Show only active messages (default: true)
- `currentVersionOnly` (boolean, optional): Show only current versions (default: true)

**Response:**
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "chatId": "chat-uuid",
        "conversationId": "conv-uuid",
        "userId": "user-uuid",
        "role": "user|assistant",
        "content": "Message content",
        "messageIndex": 0,
        "isActive": true,
        "versionNumber": 1,
        "isCurrentVersion": true,
        "hasMultipleVersions": false,
        "totalVersions": 1,
        "availableVersions": [
          {
            "versionNumber": 1,
            "isCurrentVersion": true,
            "createdAt": "2024-01-01T00:00:00Z",
            "contentPreview": "Message preview..."
          }
        ],
        "editInfo": {
          "canEdit": true,
          "lastEditedAt": "2024-01-01T00:00:00Z",
          "isEdited": false
        },
        "createdAt": "2024-01-01T00:00:00Z",
        "updatedAt": "2024-01-01T00:00:00Z"
      }
    ],
    "lastEvaluatedKey": "pagination-key",
    "limit": 20,
    "totalResults": 100,
    "hasMore": true,
    "conversationInfo": {
      "conversationId": "conv-uuid",
      "totalMessages": 100,
      "activeMessages": 95
    }
  }
}
```

### Get Chat by ID
Retrieve a specific chat message with full details.

**Endpoint:** `GET /:chatId`

**Response:**
```json
{
  "success": true,
  "data": {
    "chatId": "chat-uuid",
    "conversationId": "conv-uuid",
    "role": "user|assistant",
    "content": "Message content",
    "versionNumber": 1,
    "isCurrentVersion": true,
    "hasMultipleVersions": false,
    "totalVersions": 1,
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

---

## Chat Creation Endpoints

### Create Chat with Streaming
Create a new chat with AI response using Server-Sent Events (SSE).

**Endpoint:** `POST /stream`

**Content-Type:** `application/json`

**Request Body:**
```json
{
  "model": "gpt-4", // Required: AI model to use
  "messages": [     // Required: Array of messages
    {
      "role": "user",
      "content": "Hello, how are you?"
    }
  ],
  "max_tokens": 1000,           // Optional: Maximum response tokens
  "conversationId": "conv-uuid" // Optional: Existing conversation ID
}
```

**Response:** Server-Sent Events stream

**Stream Events:**
1. **Data chunks:** Real-time AI response
```
data: {"choices":[{"delta":{"content":"Hello"}}]}
```

2. **Completion:** Final usage and cost information
```
data: {
  "conversation": {
    "conversationId": "conv-uuid",
    "title": "Conversation Title"
  },
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  },
  "cost": {
    "usd": 0.001,
    "idr": 15.5
  },
  "userMessage": { /* user message object */ },
  "assistantMessage": { /* assistant message object */ }
}
```

3. **End signal:**
```
data: [DONE]
```

### Process File with Streaming
Process a file with AI and get streaming response.

**Endpoint:** `POST /process-file/stream`

**Request Body:**
```json
{
  "fileId": "file-uuid",       // Required: Uploaded file ID
  "model": "gpt-4-vision",     // Required: AI model to use
  "prompt": "Analyze this image", // Required: User prompt
  "max_tokens": 1000,          // Optional: Maximum response tokens
  "conversationId": "conv-uuid" // Optional: Existing conversation ID
}
```

**Response:** Server-Sent Events stream (same format as chat stream)

---

## Message Editing Endpoints

### Edit User Message
Edit a user message content. Creates a new version without auto-regenerating AI response.

**Endpoint:** `PUT /:chatId/edit`

**Request Body:**
```json
{
  "content": "Updated message content" // Required: New message content
}
```

**Response:**
```json
{
  "success": true,
  "message": "Message edited successfully",
  "data": {
    "editedMessage": {
      "chatId": "chat-uuid",
      "content": "Updated message content",
      "versionNumber": 2,
      "isCurrentVersion": true,
      "hasMultipleVersions": true,
      "totalVersions": 2,
      "availableVersions": [
        {
          "versionNumber": 1,
          "isCurrentVersion": false,
          "createdAt": "2024-01-01T00:00:00Z",
          "content": "Original message..."
        },
        {
          "versionNumber": 2,
          "isCurrentVersion": true,
          "createdAt": "2024-01-01T01:00:00Z",
          "content": "Updated message..."
        }
      ]
    },
    "branchInfo": {
      "branchCreated": true,
      "deactivatedMessagesCount": 3,
      "message": "Message edited. Subsequent messages have been deactivated. You can generate a new response or switch between versions."
    }
  }
}
```

### Edit Assistant Response
Edit an assistant response content. Creates a new version without triggering regeneration.

**Endpoint:** `PUT /:chatId/edit-response`

**Request Body:**
```json
{
  "content": "Updated response content" // Required: New response content
}
```

**Response:**
```json
{
  "success": true,
  "message": "Response edited successfully",
  "data": {
    "editedResponse": {
      "chatId": "chat-uuid",
      "content": "Updated response content",
      "versionNumber": 2,
      "isCurrentVersion": true,
      "hasMultipleVersions": true,
      "totalVersions": 2,
      "availableVersions": [/* version array */]
    },
    "versionInfo": {
      "message": "Response edited successfully. New version created.",
      "currentVersion": 2,
      "totalVersions": 2
    }
  }
}
```

---

## Response Generation Endpoints

### Generate AI Response
Generate a new AI response for a user message using streaming.

**Endpoint:** `POST /:chatId/generate`

**Request Body:**
```json
{
  "model": "gpt-4" // Required: AI model to use
}
```

**Response:** Server-Sent Events stream

**Stream Events:**
1. **Data chunks:** Real-time AI response
2. **Completion:** Usage, cost, and versioning information
```
data: {
  "usage": { /* token usage */ },
  "cost": { /* cost information */ },
  "assistantMessage": {
    "chatId": "assistant-chat-uuid",
    "content": "Generated response",
    "versionNumber": 1,
    "hasMultipleVersions": false,
    "totalVersions": 1,
    "isNewVersion": false
  }
}
```

---

## Versioning Endpoints

### Switch to Version
Switch to a specific version of a message.

**Endpoint:** `POST /:chatId/switch-version`

**Request Body:**
```json
{
  "versionNumber": 1 // Required: Version number to switch to
}
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully switched to version",
  "data": {
    "switchedToVersion": {
      "chatId": "chat-uuid",
      "content": "Version content",
      "versionNumber": 1,
      "isCurrentVersion": true,
      "hasMultipleVersions": true,
      "totalVersions": 3,
      "availableVersions": [/* version array */]
    },
    "conversationThread": [/* updated conversation messages */],
    "switchInfo": {
      "message": "Successfully switched to version 1",
      "affectedMessages": 10
    }
  }
}
```

### Get Chat Versions
Retrieve all versions of a specific chat message.

**Endpoint:** `GET /:chatId/versions`

**Response:**
```json
{
  "success": true,
  "data": {
    "versions": [
      {
        "chatId": "version-chat-uuid",
        "versionId": "version-uuid",
        "versionNumber": 1,
        "isCurrentVersion": false,
        "content": "Version 1 content",
        "contentPreview": "Version 1 content preview...",
        "wordCount": 25,
        "characterCount": 150,
        "createdAt": "2024-01-01T00:00:00Z",
        "updatedAt": "2024-01-01T00:00:00Z",
        "versionHistory": [/* version metadata */]
      },
      {
        "chatId": "version-chat-uuid-2",
        "versionId": "version-uuid-2",
        "versionNumber": 2,
        "isCurrentVersion": true,
        "content": "Version 2 content",
        "contentPreview": "Version 2 content preview...",
        "wordCount": 30,
        "characterCount": 180,
        "createdAt": "2024-01-01T01:00:00Z",
        "updatedAt": "2024-01-01T01:00:00Z",
        "versionHistory": [/* version metadata */]
      }
    ]
  }
}
```

---

## Chat Management Endpoints

### Delete Chat
Soft delete a chat message (marks as inactive).

**Endpoint:** `DELETE /:chatId`

**Response:** `204 No Content`

---

## Error Responses

All endpoints may return these error responses:

### 400 Bad Request
```json
{
  "success": false,
  "code": 400,
  "message": "Validation error message"
}
```

### 401 Unauthorized
```json
{
  "success": false,
  "code": 401,
  "message": "Authorization token missing or invalid"
}
```

### 403 Forbidden
```json
{
  "success": false,
  "code": 403,
  "message": "Access denied to this resource"
}
```

### 404 Not Found
```json
{
  "success": false,
  "code": 404,
  "message": "Resource not found"
}
```

### 402 Payment Required
```json
{
  "success": false,
  "code": 402,
  "message": "Insufficient balance for this operation",
  "required": 15.5,
  "current": 10.0
}
```

### 500 Internal Server Error
```json
{
  "success": false,
  "code": 500,
  "message": "Internal server error"
}
```

---

## Usage Examples

### Frontend Integration Examples

#### 1. Creating a New Chat with Streaming
```javascript
const createChatStream = async (model, messages, conversationId = null) => {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      model,
      messages,
      conversationId
    })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          console.log('Stream completed');
          return;
        }
        
        try {
          const parsed = JSON.parse(data);
          if (parsed.choices?.[0]?.delta?.content) {
            // Handle streaming content
            updateUI(parsed.choices[0].delta.content);
          }
          if (parsed.conversation) {
            // Handle completion data
            handleCompletion(parsed);
          }
        } catch (e) {
          console.error('Parse error:', e);
        }
      }
    }
  }
};
```

#### 2. Editing a Message
```javascript
const editMessage = async (chatId, newContent) => {
  const response = await fetch(`/api/chat/${chatId}/edit`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ content: newContent })
  });

  const result = await response.json();
  
  if (result.success) {
    // Handle successful edit
    console.log('Message edited:', result.data.editedMessage);
    console.log('Branch info:', result.data.branchInfo);
    
    // Update UI to show versioning options
    showVersioningUI(result.data.editedMessage.availableVersions);
  }
};
```

#### 3. Generating Response for User Message
```javascript
const generateResponse = async (userChatId, model) => {
  const response = await fetch(`/api/chat/${userChatId}/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ model })
  });

  // Handle streaming response similar to createChatStream
  handleStreamingResponse(response);
};
```

#### 4. Switching Between Versions
```javascript
const switchToVersion = async (chatId, versionNumber) => {
  const response = await fetch(`/api/chat/${chatId}/switch-version`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ versionNumber })
  });

  const result = await response.json();
  
  if (result.success) {
    // Update conversation view
    updateConversationView(result.data.conversationThread);
    console.log('Switched to version:', result.data.switchedToVersion);
  }
};
```

---

## Best Practices

### 1. Handling Versioning in UI
- Always check `hasMultipleVersions` to show version controls
- Display version numbers and creation dates for user clarity
- Provide easy switching between versions
- Show preview of different versions

### 2. Streaming Response Handling
- Implement proper error handling for stream interruptions
- Show loading states during streaming
- Handle balance depletion gracefully
- Provide cancel functionality for long responses

### 3. Error Handling
- Always check response status codes
- Handle insufficient balance errors with topup prompts
- Provide meaningful error messages to users
- Implement retry mechanisms for network errors

### 4. Performance Optimization
- Use pagination for conversation history
- Implement virtual scrolling for long conversations
- Cache conversation data appropriately
- Debounce edit operations

### 5. User Experience
- Provide clear feedback when creating versions
- Show cost estimates before operations
- Implement undo functionality where possible
- Provide keyboard shortcuts for common operations