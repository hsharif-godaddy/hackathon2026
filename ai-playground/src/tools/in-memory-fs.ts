/**
 * In-Memory Filesystem Mock
 * Provides a simple file system interface for testing and playground use
 */

export interface InMemoryFile {
  content: string
  created: Date
  modified: Date
}

export interface InMemoryDirectory {
  [key: string]: InMemoryFile | InMemoryDirectory
}

export class InMemoryFileSystem {
  private root: InMemoryDirectory = Object.create(null)

  /**
   * Check if a path exists
   */
  exists(path: string): boolean {
    try {
      this.navigate(path)
      return true
    } catch {
      return false
    }
  }

  /**
   * Read file content
   */
  readFile(path: string): string {
    const item = this.navigate(path)
    if (!this.isFile(item)) {
      throw new Error(`Path is not a file: ${path}`)
    }
    return item.content
  }

  /**
   * Write file content
   */
  writeFile(path: string, content: string): void {
    const { parent, name } = this.getParentAndName(path)
    const now = new Date()
    
    // Prevent prototype pollution
    if (this.isDangerousProperty(name)) {
      throw new Error(`Invalid filename: ${name}`)
    }
    
    if (Object.prototype.hasOwnProperty.call(parent, name) && this.isFile(parent[name])) {
      // Update existing file
      ;(parent[name] as InMemoryFile).content = content
      ;(parent[name] as InMemoryFile).modified = now
    } else {
      // Create new file using safe property assignment
      Object.defineProperty(parent, name, {
        value: {
          content,
          created: now,
          modified: now
        },
        writable: true,
        enumerable: true,
        configurable: true
      })
    }
  }

  /**
   * Create directory
   */
  mkdir(path: string): void {
    const { parent, name } = this.getParentAndName(path)
    
    // Prevent prototype pollution
    if (this.isDangerousProperty(name)) {
      throw new Error(`Invalid directory name: ${name}`)
    }
    
    if (!Object.prototype.hasOwnProperty.call(parent, name)) {
      // Create directory using safe property assignment
      Object.defineProperty(parent, name, {
        value: Object.create(null),
        writable: true,
        enumerable: true,
        configurable: true
      })
    }
  }

  /**
   * List directory contents
   */
  readdir(path: string): string[] {
    const item = this.navigate(path)
    if (this.isFile(item)) {
      throw new Error(`Path is not a directory: ${path}`)
    }
    return Object.keys(item as InMemoryDirectory)
  }

  /**
   * Delete file or directory
   */
  remove(path: string): void {
    const { parent, name } = this.getParentAndName(path)
    delete parent[name]
  }

  /**
   * Get file stats
   */
  stat(path: string): { isFile: boolean; isDirectory: boolean; size: number; modified: Date } {
    const item = this.navigate(path)
    const isFile = this.isFile(item)
    
    return {
      isFile,
      isDirectory: !isFile,
      size: isFile ? (item as InMemoryFile).content.length : 0,
      modified: isFile ? (item as InMemoryFile).modified : new Date()
    }
  }

  /**
   * Get all files (for debugging/inspection)
   */
  getAllFiles(): Record<string, string> {
    const files: Record<string, string> = Object.create(null)
    
    const traverse = (obj: InMemoryDirectory, currentPath: string = '') => {
      for (const [key, value] of Object.entries(obj)) {
        const fullPath = currentPath ? `${currentPath}/${key}` : key
        
        if (this.isFile(value)) {
          // Safe assignment since fullPath is constructed from validated paths
          files[fullPath] = (value as InMemoryFile).content
        } else {
          traverse(value as InMemoryDirectory, fullPath)
        }
      }
    }
    
    traverse(this.root)
    return files
  }

  /**
   * Initialize with sample HTML files
   */
  initializeSample(): void {
    this.writeFile('index.html', `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sample Page</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <header>
        <h1>Welcome to My Website</h1>
        <nav>
            <ul>
                <li><a href="#home">Home</a></li>
                <li><a href="#about">About</a></li>
                <li><a href="#contact">Contact</a></li>
            </ul>
        </nav>
    </header>
    
    <main>
        <section id="home">
            <h2>Home Section</h2>
            <p>This is the home section of the website.</p>
        </section>
    </main>
    
    <footer>
        <p>&copy; 2024 My Website. All rights reserved.</p>
    </footer>
    
    <script src="script.js"></script>
</body>
</html>`)

    this.writeFile('styles.css', `body {
    font-family: Arial, sans-serif;
    margin: 0;
    padding: 0;
    line-height: 1.6;
}

header {
    background-color: #333;
    color: white;
    padding: 1rem 0;
}

header h1 {
    text-align: center;
    margin: 0;
}

nav ul {
    list-style: none;
    padding: 0;
    text-align: center;
}

nav li {
    display: inline;
    margin: 0 1rem;
}

nav a {
    color: white;
    text-decoration: none;
}

nav a:hover {
    text-decoration: underline;
}

main {
    padding: 2rem;
    max-width: 800px;
    margin: 0 auto;
}

footer {
    background-color: #f4f4f4;
    text-align: center;
    padding: 1rem 0;
    margin-top: 2rem;
}`)

    this.writeFile('script.js', `document.addEventListener('DOMContentLoaded', function() {
    console.log('Website loaded successfully!');
    
    // Add click handlers to navigation links
    const navLinks = document.querySelectorAll('nav a');
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('Clicked:', this.textContent);
        });
    });
});`)
  }

  private navigate(path: string): InMemoryFile | InMemoryDirectory {
    const parts = path.split('/').filter(part => part !== '' && part !== '.')
    let current: InMemoryFile | InMemoryDirectory = this.root

    for (const part of parts) {
      // Prevent prototype pollution during navigation
      if (this.isDangerousProperty(part)) {
        throw new Error(`Invalid path component: ${part}`)
      }
      
      if (this.isFile(current)) {
        throw new Error(`Cannot navigate into file: ${path}`)
      }
      
      const dir = current as InMemoryDirectory
      if (!Object.prototype.hasOwnProperty.call(dir, part)) {
        throw new Error(`Path not found: ${path}`)
      }
      
      current = dir[part]
    }

    return current
  }

  private getParentAndName(path: string): { parent: InMemoryDirectory; name: string } {
    const parts = path.split('/').filter(part => part !== '' && part !== '.')
    const name = parts.pop()!
    
    let parent = this.root
    for (const part of parts) {
      // Prevent prototype pollution by checking for dangerous property names
      if (this.isDangerousProperty(part)) {
        throw new Error(`Invalid path component: ${part}`)
      }
      
      if (this.isFile(parent[part])) {
        throw new Error(`Cannot create path through file: ${path}`)
      }
      
      if (!Object.prototype.hasOwnProperty.call(parent, part)) {
        // Use Object.create(null) to create objects without prototype
        Object.defineProperty(parent, part, {
          value: Object.create(null),
          writable: true,
          enumerable: true,
          configurable: true
        })
      }
      
      parent = parent[part] as InMemoryDirectory
    }

    return { parent, name }
  }

  private isFile(item: InMemoryFile | InMemoryDirectory): item is InMemoryFile {
    return typeof (item as InMemoryFile).content === 'string'
  }

  private isDangerousProperty(key: string): boolean {
    // Prevent prototype pollution by blocking dangerous property names
    const dangerousKeys = [
      '__proto__',
      'constructor',
      'prototype',
      'hasOwnProperty',
      'isPrototypeOf',
      'propertyIsEnumerable',
      'toString',
      'valueOf'
    ]
    return dangerousKeys.includes(key)
  }
}

// Global instance for the playground
export const memoryFS = new InMemoryFileSystem()