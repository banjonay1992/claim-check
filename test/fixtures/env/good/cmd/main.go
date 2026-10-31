package main

import "os"

func main() {
	level := os.Getenv("LOG_LEVEL")
	_ = level
}
