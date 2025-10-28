.PHONY: build push run stop login

# Set your private Docker repository
DOCKER_REGISTRY = docker.io/anulom
SERVICE_NAME = document-collection-backend
SERVICE_IMAGE = $(DOCKER_REGISTRY)/$(SERVICE_NAME)
TAG = 23.10.25

# Load environment variables from .env file if present
ifneq (,$(wildcard .env))
    include .env
    export
endif

build:
	docker build -t $(SERVICE_IMAGE):${TAG} .

push: login
	docker push $(SERVICE_IMAGE):${TAG}

login:
	docker login $(DOCKER_REGISTRY)