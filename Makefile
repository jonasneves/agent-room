.DEFAULT_GOAL := help

.PHONY: help preview

help:
	@echo ""
	@echo "\033[2mDev\033[0m"
	@echo "  \033[36mpreview\033[0m  Start local server at http://localhost:8080"
	@echo ""

preview:
	@printf "\n\033[1;36m  agent-room: http://localhost:8080\033[0m\n\n"
	@python3 -m http.server 8080 --bind 127.0.0.1 2>/dev/null
