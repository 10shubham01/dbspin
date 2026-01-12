````md
# DB Connect CLI

A simple CLI to quickly connect to PostgreSQL databases using `pgcli` or `psql`.

Made with love by [Shubham](https://github.com/10shubham01)

---

## Features

- Choose between `pgcli` or `psql`
- Select environment (if multiple `.env` files exist)
- Pick port alias and database from interactive prompts
- Support for direct command-line arguments
- **📊 Visualize query results with interactive Chart.js graphs**

---

## Usage

### Interactive Mode (default)

```bash
dbspin
```

This will prompt you to select environment, tool, port alias, and database interactively.

### Direct Mode

You can also pass the port alias and database directly as arguments:

```bash
dbspin <port_alias> <database_name>
```

For example:

```bash
dbspin d7 db_novio_score
```

This will skip the interactive prompts for port alias and database, using the provided values directly.

### Visualization Mode 📊

Execute a SQL query and visualize the results with interactive Chart.js graphs:

```bash
dbspin --visualize <port_alias> <database> "<SQL_QUERY>"
# or use the short form
dbspin -v <port_alias> <database> "<SQL_QUERY>"
```

**Examples:**

```bash
# Basic visualization - auto-detects best chart type
dbspin -v d7 db_novio_score "SELECT status, COUNT(*) as count FROM users GROUP BY status"

# Specify chart type (bar, line, pie, doughnut, radar)
dbspin -v d7 db_novio_score "SELECT date, revenue FROM sales LIMIT 10" --chart line

# Time series data
dbspin --visualize d7 db_customer "SELECT DATE(created_at) as date, COUNT(*) as signups FROM customers WHERE created_at >= NOW() - INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY date"

# Multiple metrics
dbspin -v d7 db_credilio "SELECT month, revenue, costs, profit FROM monthly_stats" --chart line
```

**Features:**
- 📈 Interactive charts with Chart.js
- 🎨 Multiple chart types: Bar, Line, Pie, Doughnut, Radar
- 📊 Auto-detection of optimal chart type
- 📋 Data table view alongside charts
- 🔄 Switch between chart types in real-time
- 🎯 Beautiful gradient UI
- 📱 Responsive design

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/10shubham01/dbspin.git
cd dbspin
```
````

### 2. Install dependencies

```bash
npm install
```

### 3. Create `.env` files

Create `.env.dev`, `.env.prod`, etc. with the following variables:

```env
DB_READ_PROXY_HOST=your-host
DB_READ_PROXY_USER=your-user
DB_READ_PROXY_PASSWORD=your-password
```

### 4. Update configuration

Edit the `dbconfig.json` file to match your setup:

```json
{
  "defaults": {
    "tool": "psql",
    "environment": "dev",
    "portAlias": "dev",
    "database": "main_db"
  },

  "prompts": {
    "tool": false,
    "environment": true,
    "port": true,
    "database": true
  },

  "availableTools": ["pgcli", "psql"],
  "environments": {
    "dev": {
      "portAliases": {
        "dev": "6004",
        "qa": "6005",
        "uat": "6006"
      },
      "databases": ["main_db", "analytics_db"]
    },
    "prod": {
      "portAliases": {
        "prod": "6001",
        "d1": "6002",
        "d2": "6003"
      },
      "databases": ["main_db", "analytics_db"]
    }
  }
}
```

---

## Run globally

```bash
npm link
dbspin
```

Or with direct arguments:

```bash
dbspin d7 db_novio_score
```

---

## Setup Tab Completion (Optional)

For zsh completion, add this to your `~/.zshrc`:

```bash
# Add dbspin completion
source /path/to/dbspin/dbspin-completion.zsh
```

Or run this command to add it automatically:

```bash
echo "source $(pwd)/dbspin-completion.zsh" >> ~/.zshrc
source ~/.zshrc
```

Now you can use tab completion for port aliases and database names!

---

## Install Required Tools

### pgcli

```bash
# macOS
brew install pgcli

# Ubuntu
pip3 install pgcli

# Windows
pip3 install pgcli
```

### psql

```bash
# macOS
brew install postgresql

# Ubuntu
sudo apt install postgresql-client

# Windows
Download from: https://www.postgresql.org/download/windows/
```

---

## Notes

- Environments are selected only if multiple `.env.*` files exist
- Secrets remain in `.env` files and are never hardcoded

---
