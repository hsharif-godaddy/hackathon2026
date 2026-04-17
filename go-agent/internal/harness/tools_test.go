package harness

import (
	"encoding/json"
	"testing"
)

func TestToolDefinitions(t *testing.T) {
	tools := ToolDefinitions()

	if len(tools) != 5 {
		t.Fatalf("expected 5 tools, got %d", len(tools))
	}

	expectedNames := map[string]bool{
		"askQuestion":    false,
		"setProjectName": false,
		"todoList":       false,
		"handoff":        false,
		"websiteRebuild": false,
	}

	for _, tool := range tools {
		if tool.Name == "" {
			t.Error("tool has empty name")
		}
		if tool.Description == "" {
			t.Errorf("tool %q has empty description", tool.Name)
		}
		if tool.InputSchemaJSON == "" {
			t.Errorf("tool %q has empty InputSchemaJSON", tool.Name)
		}

		// Validate JSON is parseable
		var schema map[string]any
		if err := json.Unmarshal([]byte(tool.InputSchemaJSON), &schema); err != nil {
			t.Errorf("tool %q has invalid JSON schema: %v", tool.Name, err)
		}

		// Validate top-level type is "object"
		if schemaType, ok := schema["type"]; !ok || schemaType != "object" {
			t.Errorf("tool %q schema missing or incorrect top-level type: got %v", tool.Name, schema["type"])
		}

		if _, known := expectedNames[tool.Name]; !known {
			t.Errorf("unexpected tool name: %q", tool.Name)
		}
		expectedNames[tool.Name] = true
	}

	for name, seen := range expectedNames {
		if !seen {
			t.Errorf("missing expected tool: %q", name)
		}
	}
}

func TestAskQuestionSchema(t *testing.T) {
	tools := ToolDefinitions()

	var askQuestion *ToolDefinition
	for i := range tools {
		if tools[i].Name == "askQuestion" {
			askQuestion = &tools[i]
			break
		}
	}
	if askQuestion == nil {
		t.Fatal("askQuestion tool not found")
		return
	}

	var schema map[string]any
	if err := json.Unmarshal([]byte(askQuestion.InputSchemaJSON), &schema); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}

	properties, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatal("schema missing properties")
	}

	questionsSchema, ok := properties["questions"].(map[string]any)
	if !ok {
		t.Fatal("schema missing questions property")
	}

	if questionsSchema["type"] != "array" {
		t.Errorf("questions should be type array, got %v", questionsSchema["type"])
	}

	if minItems, okMin := questionsSchema["minItems"].(float64); !okMin || minItems != 1 {
		t.Errorf("questions should have minItems=1, got %v", questionsSchema["minItems"])
	}

	if maxItems, okMax := questionsSchema["maxItems"].(float64); !okMax || maxItems != 10 {
		t.Errorf("questions should have maxItems=10, got %v", questionsSchema["maxItems"])
	}

	items, ok := questionsSchema["items"].(map[string]any)
	if !ok {
		t.Fatal("questions missing items definition")
	}

	itemProps, ok := items["properties"].(map[string]any)
	if !ok {
		t.Fatal("question items missing properties")
	}

	for _, prop := range []string{"question", "suggestions", "allowOther", "multiSelect"} {
		if _, exists := itemProps[prop]; !exists {
			t.Errorf("question item missing property %q", prop)
		}
	}

	// Check required fields on item
	required, ok := items["required"].([]any)
	if !ok {
		t.Fatal("question items missing required array")
	}
	requiredSet := make(map[string]bool)
	for _, r := range required {
		if s, okStr := r.(string); okStr {
			requiredSet[s] = true
		}
	}
	for _, field := range []string{"question", "suggestions"} {
		if !requiredSet[field] {
			t.Errorf("question item required missing field %q", field)
		}
	}

	// Check top-level required includes "questions"
	topRequired, ok := schema["required"].([]any)
	if !ok {
		t.Fatal("schema missing top-level required array")
	}
	foundQuestions := false
	for _, r := range topRequired {
		if r == "questions" {
			foundQuestions = true
		}
	}
	if !foundQuestions {
		t.Error("top-level required missing 'questions'")
	}
}

func TestTodoListSchemaOperations(t *testing.T) {
	tools := ToolDefinitions()

	var todoList *ToolDefinition
	for i := range tools {
		if tools[i].Name == "todoList" {
			todoList = &tools[i]
			break
		}
	}
	if todoList == nil {
		t.Fatal("todoList tool not found")
		return
	}

	var schema map[string]any
	if err := json.Unmarshal([]byte(todoList.InputSchemaJSON), &schema); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}

	properties, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatal("schema missing properties")
	}

	operationProp, ok := properties["operation"].(map[string]any)
	if !ok {
		t.Fatal("schema missing operation property")
	}

	enumValues, ok := operationProp["enum"].([]any)
	if !ok {
		t.Fatal("operation missing enum")
	}

	expectedOps := []string{
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
		"select_list",
	}

	if len(enumValues) != len(expectedOps) {
		t.Errorf("expected %d operations, got %d", len(expectedOps), len(enumValues))
	}

	enumSet := make(map[string]bool)
	for _, v := range enumValues {
		if s, okStr := v.(string); okStr {
			enumSet[s] = true
		}
	}

	for _, op := range expectedOps {
		if !enumSet[op] {
			t.Errorf("missing operation %q", op)
		}
	}

	// Check top-level required includes "operation"
	topRequired, ok := schema["required"].([]any)
	if !ok {
		t.Fatal("schema missing top-level required array")
	}
	foundOp := false
	for _, r := range topRequired {
		if r == "operation" {
			foundOp = true
		}
	}
	if !foundOp {
		t.Error("top-level required missing 'operation'")
	}
}
