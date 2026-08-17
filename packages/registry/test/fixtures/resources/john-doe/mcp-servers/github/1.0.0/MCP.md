---
name: github
description: GitHub MCP server for repository workflows.
transport: http
url: https://api.githubcopilot.com/mcp/
headers:
  Authorization: "Bearer {env:GITHUB_PAT}"
env:
  - name: GITHUB_PAT
    required: true
    description: GitHub personal access token
---

# GitHub MCP

Connect GitHub repositories, issues, and pull requests.