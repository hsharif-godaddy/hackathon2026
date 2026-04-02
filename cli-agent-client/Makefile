.PHONY: build run clean

build:
	go build -o bin/cli-agent-client ./cmd/cli-agent-client

run: build
	./bin/cli-agent-client $(ARGS)

clean:
	rm -rf bin/
