package main

import (
	"fmt"
	"os"
)

var Version = "dev"

func main() {
	fmt.Fprintf(os.Stderr, "go-agent %s\n", Version)
}
