package harness

// ToolDefinition holds the name, description, and JSON schema for a tool
// as seen by the LLM.
type ToolDefinition struct {
	Name            string
	Description     string
	InputSchemaJSON string
}

// ToolDefinitions returns the canonical list of tool schemas that match
// the production TypeScript tool definitions. The LLM uses these schemas
// to decide how to call tools; they must stay in sync with the TypeScript
// sources under agents/src/tools/ai-lib-tools/ and packages/ai-lib/.
func ToolDefinitions() []ToolDefinition {
	return []ToolDefinition{
		askQuestionTool(),
		setProjectNameTool(),
		todoListTool(),
		handoffTool(),
		websiteRebuildTool(),
	}
}

func askQuestionTool() ToolDefinition {
	return ToolDefinition{
		Name: "askQuestion",
		Description: `Ask the user one or more questions with suggested answers.
Questions are displayed one at a time in the UI. Users can select a suggestion or provide their own answer.
The agent will receive all answers in a formatted response once the user completes all questions.

Use this instead of asking questions directly in your response text.`,
		InputSchemaJSON: `{
  "type": "object",
  "properties": {
    "questions": {
      "type": "array",
      "description": "Array of questions to ask (minimum 1, maximum 10)",
      "minItems": 1,
      "maxItems": 10,
      "items": {
        "type": "object",
        "properties": {
          "question": {
            "type": "string",
            "description": "The question to ask the user"
          },
          "suggestions": {
            "type": "array",
            "description": "Array of suggested answers (minimum 1)",
            "minItems": 1,
            "items": {
              "oneOf": [
                {
                  "type": "string",
                  "description": "Suggested answer as plain string (displayed and used as value)"
                },
                {
                  "type": "object",
                  "description": "Suggested answer as object when value to send should differ from displayed text",
                  "properties": {
                    "text": {
                      "type": "string",
                      "description": "The suggestion text to display"
                    },
                    "value": {
                      "type": "string",
                      "description": "Optional: different value to send vs display"
                    }
                  },
                  "required": ["text"]
                }
              ]
            }
          },
          "allowOther": {
            "type": "boolean",
            "default": true,
            "description": "Whether to show \"Other\" option for free text input"
          },
          "multiSelect": {
            "type": "boolean",
            "default": false,
            "description": "Whether to allow selecting multiple answers (checkboxes) or single answer (radio buttons)"
          },
          "metadata": {
            "type": "object",
            "description": "Optional metadata for tracking",
            "additionalProperties": true
          }
        },
        "required": ["question", "suggestions"]
      }
    }
  },
  "required": ["questions"]
}`,
	}
}

func setProjectNameTool() ToolDefinition {
	return ToolDefinition{
		Name:        "setProjectName",
		Description: "Set the project name after gathering necessary information from the user.",
		InputSchemaJSON: `{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "The project name to set (1-100 characters)",
      "minLength": 1,
      "maxLength": 100
    }
  },
  "required": ["name"]
}`,
	}
}

func todoListTool() ToolDefinition {
	return ToolDefinition{
		Name:        "todoList",
		Description: "Create and manage todo lists for planning. CRITICAL: Mark items complete IMMEDIATELY after finishing each task - do not wait until end of workflow or git commit. Use show_list to display completed work. Use select_list to switch between todo lists. Use this to break down complex tasks and track progress in real-time.",
		InputSchemaJSON: `{
  "type": "object",
  "properties": {
    "operation": {
      "type": "string",
      "description": "The operation to perform. Use show_list to display a completed todo list. Use select_list to switch to a different list.",
      "enum": [
        "create_list",
        "get_list",
        "show_list",
        "list_all",
        "delete_list",
        "add_items",
        "update_items",
        "delete_items",
        "mark_done",
        "mark_undone",
        "select_list"
      ]
    },
    "appId": {
      "type": "string",
      "description": "App ID to associate the list with (usually from context)"
    },
    "listId": {
      "type": "string",
      "description": "ID of the todo list (required for get_list, show_list, select_list, delete_list, add_items)"
    },
    "listName": {
      "type": "string",
      "description": "Name of the todo list (required for create_list)"
    },
    "listDescription": {
      "type": "string",
      "description": "Description of the todo list"
    },
    "items": {
      "type": "array",
      "description": "Array of items - for create_list (with list) or add_items (to existing list). Can be single item or multiple.",
      "items": {
        "type": "object",
        "properties": {
          "title": {
            "type": "string",
            "description": "Title of the item"
          },
          "description": {
            "type": "string",
            "description": "Description of the item"
          },
          "completed": {
            "type": "boolean",
            "description": "Whether the item is completed (default: false)"
          },
          "order": {
            "type": "number",
            "description": "Order/position of the item (auto-assigned if not specified)"
          }
        },
        "required": ["title"]
      }
    },
    "itemIds": {
      "type": "array",
      "description": "Array of item IDs - for mark_done, mark_undone, delete_items. Can be single ID or multiple.",
      "items": {
        "type": "string"
      }
    },
    "updates": {
      "type": "array",
      "description": "Array of updates - for update_items operation. Can update single item or multiple.",
      "items": {
        "type": "object",
        "properties": {
          "itemId": {
            "type": "string",
            "description": "ID of the item to update"
          },
          "title": {
            "type": "string",
            "description": "New title"
          },
          "description": {
            "type": "string",
            "description": "New description"
          },
          "order": {
            "type": "number",
            "description": "New order/position"
          }
        },
        "required": ["itemId"]
      }
    }
  },
  "required": ["operation"]
}`,
	}
}

func handoffTool() ToolDefinition {
	return ToolDefinition{
		Name:        "handoff",
		Description: "Hand off control to another agent. Never announce the handoff or name agents/roles in chat (no \"hand off\", \"pass to\", \"let me get\"). A brief first-person task confirm is OK (e.g. \"I'll run an SEO analysis on your site\"), then call this tool immediately. Say nothing after.",
		InputSchemaJSON: `{
  "type": "object",
  "properties": {
    "targetAgent": {
      "type": "string",
      "description": "ID of the agent to hand off to. Available: develop"
    },
    "prompt": {
      "type": "string",
      "description": "Brief summary of what you completed. Do NOT add new instructions or tasks."
    }
  },
  "required": ["targetAgent", "prompt"]
}`,
	}
}

func websiteRebuildTool() ToolDefinition {
	return ToolDefinition{
		Name:        "websiteRebuild",
		Description: "Rebuild an existing website from a URL. Scrapes the source, downloads assets, and generates build prompts.",
		InputSchemaJSON: `{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "description": "The URL of the website to rebuild",
      "format": "uri"
    }
  },
  "required": ["url"]
}`,
	}
}
