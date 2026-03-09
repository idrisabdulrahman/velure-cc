# Invoice Generator

A simple and efficient invoice generation application built with JavaScript and TypeScript. This project allows users to create, customize, and export professional invoices for personal or business use.

## Features

- **Customizable Templates**: Choose from various invoice templates to suit your needs.
- **Bun-first Tooling**: Use bun for dependency management and running scripts (e.g., `bun install`, `bun run build`, `bun run start`).
- **Export Options**: Generate invoices in PDF, HTML, or JSON formats.
- **Responsive Design**: Works seamlessly on desktop and mobile devices.
- **TypeScript Support**: Fully typed for better code reliability and developer experience.
- **Modular Architecture**: Built with Node.js for backend processing and optional frontend integration.

## Installation

### Prerequisites
- Node.js (version 20+ or higher)
-  Bun 

### Steps
1. Clone the repository:
  ```bash
  git clone https://github.com/yourusername/invoice-gen.git
  cd invoice-gen
  ```

2. Install dependencies:
  ```bash
  bun install
  ```

3. Build the project:
  ```bash
  bun run build
  ```

4. Start the application:
  ```bash
  bun  start
  ```

The app will run on `http://localhost:3000` by default.

## Usage

1. Open the application in your browser.
2. Fill in the invoice details (e.g., client info, items, amounts).
3. Customize the template if needed.
4. Preview and export the invoice.

### API Usage (if applicable)
If running as a backend service, use endpoints like:
- `POST /generate-invoice`: Generate an invoice with provided data.

Example request:
```json
{
  "client": "John Doe",
  "items": [
   {"name": "Service A", "quantity": 1, "price": 100}
  ],
  "total": 100
}
```

## Development

### Scripts
- `bun run dev`: Start development server with hot reload.
- `bun run test`: Run unit tests.
- `bun run lint`: Check code style.

### Project Structure
```
invoice-gen/
├── src/
│   ├── components/     # UI components
│   ├── models/         # Data models
│   ├── services/       # Business logic
│   └── index.ts        # Entry point
├── public/             # Static assets
├── package.json
└── README.md
```

## Contributing

Contributions are welcome! Please follow these steps:
1. Fork the repository.
2. Create a feature branch: `git checkout -b feature-name`.
3. Commit changes: `git commit -m 'Add feature'`.
4. Push to the branch: `git push origin feature-name`.
5. Open a pull request.

Ensure all tests pass and code is linted before submitting.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Support

For issues or questions, open an issue on GitHub or contact the maintainers.

---

*Built with ❤️ using JavaScript and TypeScript.*