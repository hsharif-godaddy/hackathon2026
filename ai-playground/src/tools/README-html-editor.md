# HTML File Editor Tool

A diff-based file editing tool for the AI Playground that works with an in-memory filesystem, perfect for testing HTML/CSS/JS editing scenarios.

## Features

- **In-Memory Filesystem**: No actual files on disk, perfect for safe experimentation
- **Diff-Based Editing**: Similar to the main `file-edit.ts` tool but simplified for playground use
- **Multiple Edit Modes**: Create, edit (partial), and rewrite (full replacement)
- **Fuzzy Matching**: Optional fuzzy matching for search-and-replace operations
- **Dry Run Support**: Preview changes before applying them
- **Sample Content**: Initialize with sample HTML, CSS, and JS files

## Usage

The tool is available as `html_file_editor` in the AI Playground tools and supports the following actions:

### Initialize Sample Files
```typescript
{
  action: 'init'
}
```
Creates sample `index.html`, `styles.css`, and `script.js` files.

### List Files
```typescript
{
  action: 'list'
}
```
Returns all files in the memory filesystem.

### Read File
```typescript
{
  action: 'read',
  path: 'index.html'
}
```
Reads the content of a specific file.

### Edit Files

#### Create New File
```typescript
{
  action: 'edit',
  path: 'new-file.css',
  mode: 'create',
  content: '.my-class { color: red; }'
}
```

#### Rewrite Entire File
```typescript
{
  action: 'edit',
  path: 'index.html',
  mode: 'rewrite',
  content: '<!DOCTYPE html>...'
}
```

#### Partial Edit (Search and Replace)
```typescript
{
  action: 'edit',
  path: 'index.html',
  mode: 'edit',
  edits: [
    {
      old: '<title>Sample Page</title>',
      new: '<title>My New Title</title>'
    },
    {
      old: '<h1>Welcome to My Website</h1>',
      new: '<h1>Welcome to My Awesome Site</h1>'
    }
  ]
}
```

### Options

- `dryRun: true` - Preview changes without applying them
- `fuzzyMatch: true` - Enable fuzzy matching for search text (default: true)

## Sample Files

When initialized, the tool creates:

- **index.html** - A complete HTML page with header, nav, main content, and footer
- **styles.css** - CSS styling for the HTML page
- **script.js** - JavaScript for basic interactivity

## Diff Output

The tool provides detailed diff output showing:
- Lines added (prefixed with `+`)
- Lines removed (prefixed with `-`)
- Unchanged lines (prefixed with ` `)
- Summary of changes (additions, deletions, total lines)

## Use Cases

- Testing HTML structure modifications
- Experimenting with CSS changes
- Adding JavaScript functionality
- Learning web development concepts
- Prototyping static websites
- Testing diff-based editing workflows

## Architecture

- **InMemoryFileSystem**: Mock filesystem that stores files in memory
- **HTMLFileEditor**: Core editing logic similar to the main file-edit tool
- **Tool Integration**: Exposed as a standard AI Playground tool via `createTool`

## Limitations

- Files are limited to 1MB in size
- No actual file persistence (resets on page refresh)
- Basic diff algorithm (line-based comparison)
- No advanced features like git integration or build validation

## Example Workflow

1. Initialize sample files
2. Read current content to understand structure
3. Make targeted edits using search-and-replace
4. Preview changes with dry run
5. Apply changes and review diff output
6. Continue iterating on the content

This tool is perfect for learning, experimentation, and testing HTML/CSS/JS editing scenarios in a safe, controlled environment.