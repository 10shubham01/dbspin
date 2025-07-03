````md
# DB Connect CLI

A simple CLI to quickly connect to PostgreSQL databases using `pgcli` or `psql`.

Made with love by [Shubham](https://github.com/10shubham01)

---

## Features

- Choose between `pgcli` or `psql`
- Select environment (if multiple `.env` files exist)
- Pick port alias and database from interactive prompts

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
