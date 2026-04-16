# SetProjectNameToolRenderer Translation Keys

This tool renderer uses the following translation keys. These should be added to the GoDaddy i18n Management UI at:
https://i18n.int.gdcorp.tools/org/hcx/app/aab

## Required Translation Keys

| Key                                    | Default Value          | Description                                                                             |
| -------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| `builder_tools_setprojectname_display` | `Project name: {name}` | Display text shown in the tool header. Supports `{name}` variable for the project name. |
| `builder_tools_setprojectname_title`   | `Set Project Name`     | Title shown in the modal when clicking the tool.                                        |
| `builder_tools_setprojectname_unknown` | `Unknown`              | Fallback text when project name cannot be determined.                                   |

## Existing Translation Keys Used

The following keys are already defined and used by this renderer:

- `builder_tools_default_arguments` - "Arguments" label in modal
- `builder_tools_default_result` - "Result" label in modal

## Example Usage in Component

```typescript
const displayName = t(
  "builder_tools_setprojectname_display",
  { name: projectName },
  "Project name: {name}",
);
const title = t(
  "builder_tools_setprojectname_title",
  undefined,
  "Set Project Name",
);
const unknown = t("builder_tools_setprojectname_unknown", undefined, "Unknown");
```

## Notes

- All translation keys include default messages as fallbacks, so the component will work even before translations are added to the i18n system.
- The `{name}` variable in `builder_tools_setprojectname_display` uses ICU MessageFormat syntax.
