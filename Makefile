SHELL := /bin/zsh

# These targets always use the real Jira data source, rather than inheriting the
# application's synthetic default. Override when your persistent planner database
# lives elsewhere:
#   make dev-test-db ECP_DB_PATH=/absolute/path/to/planner.db
ECP_DB_PATH ?= $(CURDIR)/packages/backend/packages/backend/data/new-team.db

.PHONY: dev-test-db dev-persistent-db

## Start the planner against a disposable copy of ECP_DB_PATH.
dev-test-db:
	source /Users/aforsythe1/.nvm/nvm.sh && nvm use && ECP_TEST_DB=true ECP_DB_PATH="$(ECP_DB_PATH)" ECP_DATA_SOURCE=jira ECP_JIRA_FAKE=false npm run dev

## Start the planner against the persistent ECP_DB_PATH for durable changes.
dev-persistent-db:
	source /Users/aforsythe1/.nvm/nvm.sh && nvm use && ECP_TEST_DB=false ECP_DB_PATH="$(ECP_DB_PATH)" ECP_DATA_SOURCE=jira ECP_JIRA_FAKE=false npm run dev
