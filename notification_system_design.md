# Notification Priority System - System Design

## Overview

The Notification Priority System is designed to fetch notifications from an external API, calculate their importance, rank them based on priority, and return them in a sorted order.

The goal is to ensure that users see the most important and recent notifications first.

---

# Problem Statement

Different notifications have different levels of importance.

For example:

* Result announcements are highly important.
* Placement updates are moderately important.
* Event notifications are less important.

In addition to importance, recent notifications should be shown before older ones.

The system combines both factors to generate a priority score.

---

# High Level Flow

1. Authenticate with external service.
2. Obtain access token.
3. Store token for future requests.
4. Fetch notifications from API.
5. Validate incoming data.
6. Calculate priority score.
7. Sort notifications by score.
8. Return ranked notification feed.

---

# System Architecture

```text
+------------+
|   Client   |
+------------+
      |
      v
+------------------+
| Express Server   |
+------------------+
      |
      v
+------------------+
| Authentication   |
+------------------+
      |
      v
+------------------+
| Notification API |
+------------------+
      |
      v
+------------------+
| Priority Engine  |
+------------------+
      |
      v
+------------------+
| Sorted Response  |
+------------------+
```

---

# Authentication Module

### Purpose

Authenticate with the external service before accessing notifications.

### Process

* Send credentials to `/auth`
* Receive access token
* Store token in memory
* Use token for future API requests

### Benefits

* Secure communication
* Prevents unauthorized access
* Reusable authentication session

---

# Notification Retrieval Module

### Purpose

Fetch notifications from external API.

### Endpoint

```http
GET /notifications
```

### Responsibilities

* Send authenticated request
* Receive notification data
* Handle API failures
* Pass data to ranking engine

---

# Validation Module

Before processing notifications, basic validation is performed.

### Validation Rules

A notification must contain:

* ID
* Type
* Message
* Timestamp

Invalid records are skipped and logged.

### Benefits

* Prevents crashes
* Ensures data quality
* Improves reliability

---

# Priority Calculation Engine

The heart of the system.

Every notification receives a score.

## Base Scores

| Type      | Score |
| --------- | ----- |
| Result    | 100   |
| Placement | 70    |
| Event     | 40    |

---

## Time Bonus

Recent notifications get extra points.

Formula:

```text
Time Bonus = Maximum Bonus - Hours Passed
```

Where:

```text
Maximum Bonus = 30
```

Older notifications gradually lose bonus points.

---

## Final Score

```text
Priority Score = Base Score + Time Bonus
```

Example:

Result Notification:

Base Score = 100

Hours Passed = 5

Time Bonus = 30 - 5 = 25

Priority Score = 125

---

# Sorting Strategy

After scoring:

```text
Highest Score
      ↓
Lowest Score
```

Notifications are sorted in descending order.

This ensures users always see the most relevant notifications first.

---

# Logging Strategy

The system records important events.

### Info Logs

* Authentication success
* API requests
* Feed generation

### Debug Logs

* Notification processing
* Ranking operations

### Warning Logs

* Invalid notifications
* Empty responses

### Fatal Logs

* Server failures
* API failures

Benefits:

* Easier debugging
* Better monitoring
* Faster issue detection

---

# API Response Structure

```json
{
  "success": true,
  "totalNotifications": 3,
  "priorityInbox": []
}
```

---

# Error Handling

The system handles:

### Authentication Failure

* Invalid credentials
* Expired token

### API Failure

* Service unavailable
* Network issues

### Invalid Data

* Missing fields
* Incorrect formats

Errors are logged and appropriate responses are returned.

---

# Time Complexity

## Scoring

```text
O(n)
```

Each notification is processed once.

## Sorting

```text
O(n log n)
```

Sorting ranked notifications.

## Overall

```text
O(n log n)
```

---

# Advantages

* Simple implementation
* Fast ranking mechanism
* Easy to maintain
* Secure authentication
* Structured logging
* Scalable design

---

# Future Improvements

* User-specific preferences
* Machine learning based ranking
* Notification categories
* Read/Unread tracking
* Database caching
* Real-time WebSocket updates

---

# Conclusion

The Notification Priority System efficiently retrieves notifications, evaluates their importance using category-based scoring and recency, ranks them, and delivers a sorted feed to users. The design is lightweight, scalable, and suitable for real-world notification management systems.
