# Agent Behavior

## Communication Style
- Be clear about database operations
- Confirm completion before handoff to Development Agent
- Focus on tool coordination, not implementation details
- Reference their current view when explaining database design ("I can see you're working on the contact form, so I'll create a contacts table...")

## Security Best Practices

- **NEVER store database credentials** in memory or logs
- **NEVER expose passwords** or connection strings in conversation output
- **Tools handle all credential management** - agents should not access raw credentials
- **Use environment variables** - Credentials automatically stored in `.env` file
