# LoadLead repo conveniences. Keep targets short and obvious.

.PHONY: publish-docs publish-docs-check

# Publish /docs to Confluence from your local machine. Required env vars are
# documented in scripts/publish-docs.sh; they're typically loaded by your
# shell rc (.zshrc) so this is a one-word command in practice.
publish-docs:
	bash scripts/publish-docs.sh

# Dry sanity — verifies the env is set and reachable without publishing.
publish-docs-check:
	@: $${CONFLUENCE_BASE_URL?missing}
	@: $${CONFLUENCE_EMAIL?missing}
	@: $${CONFLUENCE_API_TOKEN?missing}
	@: $${CONFLUENCE_SPACE_KEY?missing}
	@: $${CONFLUENCE_PARENT_PAGE_ID?missing}
	@code=$$(curl -s -o /dev/null -w "%{http_code}" \
	  -u "$$CONFLUENCE_EMAIL:$$CONFLUENCE_API_TOKEN" \
	  -H "Accept: application/json" \
	  "$${CONFLUENCE_BASE_URL%/}/wiki/rest/api/space/$$CONFLUENCE_SPACE_KEY"); \
	  echo "GET /wiki/rest/api/space/$$CONFLUENCE_SPACE_KEY -> HTTP $$code"; \
	  test "$$code" = "200"
