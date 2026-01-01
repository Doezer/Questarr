# Contributing to Questarr

Thank you for your interest in contributing to Questarr! We welcome contributions from the community.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/Questarr.git`
3. Create a new branch: `git checkout -b feature/your-feature-name`
4. Make your changes
5. Test your changes thoroughly
6. Commit with clear messages: `git commit -m "Add feature: description"`
7. Push to your fork: `git push origin feature/your-feature-name`
8. Open a Pull Request
Note: do not merge into your own branch if you intend to do a PR

## Development Guidelines

```bash
# Run development server with hot reload
npm run dev

# Type check
npm run check

# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format
```
### Code Style

- Follow the existing TypeScript and React patterns in the codebase
- Use Tailwind CSS for styling (follow the design guidelines)
- Run `npm run lint` and `npm run format` before committing
- Ensure `npm run check` passes without TypeScript errors

### Testing

- Add tests for new features when applicable
- Run `npm test` to ensure all tests pass
- Test UI changes in both light and dark themes (currently dark-first)

### Commit Messages

- Use clear, descriptive commit messages
- Start with a verb in the present tense (e.g., "Add", "Fix", "Update")
- Reference issue numbers when applicable (e.g., "Fix #123: description")

### Pull Requests

- Provide a clear description of what your PR does
- Link related issues
- Ensure all checks pass before requesting review
- Be responsive to feedback and questions

### Installation


## Project Structure

- `/client` - React frontend application
- `/server` - Express backend application
- `/shared` - Shared types and schemas
- See `copilot-instructions.md` for detailed architecture guidelines
- 

## Need Help?

- Check existing issues for similar problems or questions
- Open a new issue if you find a bug or have a feature request
- Be respectful and constructive in all interactions

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help create a welcoming environment for all contributors
- Use of AI is welcome

Thank you for contributing to Questarr!
