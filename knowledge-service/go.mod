module github.com/airo-ai-builder/knowledge-service

go 1.25.5

require (
	github.com/gdcorp-partners/airo-app-builder/packages/go-auth v0.0.0
	github.com/golang-nlp/stopwords v1.0.0
	github.com/gorilla/mux v1.8.1
	github.com/joho/godotenv v1.5.1
	github.com/kljensen/snowball v0.10.0
	github.com/openai/openai-go/v3 v3.24.0
	github.com/qdrant/go-client v1.17.1
)

require (
	github.com/gdcorp-golang/auth v1.13.0 // indirect
	github.com/tidwall/gjson v1.18.0 // indirect
	github.com/tidwall/match v1.1.1 // indirect
	github.com/tidwall/pretty v1.2.1 // indirect
	github.com/tidwall/sjson v1.2.5 // indirect
	golang.org/x/net v0.50.0 // indirect
	golang.org/x/sys v0.41.0 // indirect
	golang.org/x/text v0.34.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260209200024-4cfbd4190f57 // indirect
	google.golang.org/grpc v1.78.0 // indirect
	google.golang.org/protobuf v1.36.11 // indirect
)

replace github.com/gdcorp-partners/airo-app-builder/packages/go-auth => ../packages/go-auth
