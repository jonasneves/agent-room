BOLD  = \033[1m
CYAN  = \033[36m
GREEN = \033[32m
RESET = \033[0m

preview:
	@printf "\n$(BOLD)$(GREEN)  agent-room$(RESET)\n$(CYAN)  http://localhost:8080$(RESET)\n\n"
	@python3 -m http.server 8080 --bind 127.0.0.1 2>/dev/null
