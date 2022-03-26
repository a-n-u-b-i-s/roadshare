# Compute Terraform Config
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~>3.69.0"
    }
  }

  backend "s3" {
    region  = "us-east-1"
  }
}

provider "aws" {
  region  = "us-east-1"
  skip_get_ec2_platforms      = true
  skip_metadata_api_check     = true
}

# Global Variables
variable "project" {
  type = string
  description = "Project To Deploy Under"
  default = "hoohacks-2022"
}

variable "environment" {
  type = string
  description = "Environment To Deploy Under"
  default = "development"
}

variable default_region {
  type = string
  description = "Global Default AWS Region"
  default = "us-east-1"
}

variable "account_id" {
  type = string
  description = "Id of AWS Account"
}

variable "memory_size" {
  type = string
  description = "Memory in MB for all lambdas"
  default = 2048
}

variable "timeout" {
  type = number
  description = "Timeout in seconds for all lambdas"
  default = 20
}


variable "global_environment_variables" {
  type = map(string)
  description = "Global environment variables for all lambda functions"
  default = {}
}

# Service Variables
variable "conversation_service_environment_variables" {
  type = map(string)
  description = "Environment variables for conversation_service"
  default = {}
}

variable "unlucky_service_environment_variables" {
  type = map(string)
  description = "Environment variables for unlucky_service"
  default = {}
}

# Service Definitions
module "conversation_service" {
  source = "../../modules/lambda"

  project = var.project
  environment = var.environment
  region = var.default_region
  account_id = var.account_id

  name = "conversation-service"
  description = "Twilio Conversation Lambda Function"

  attach_policy_statements = true
  policy_statements = {
    eventbridge_full_access = {
      effect    = "Allow",
      actions   = ["events:*"],
      resources  = ["*"]
    },
    iam_pass_role = {
      effect    = "Allow",
      actions   = ["iam:PassRole"],
      resources  = ["arn:aws:iam::*:role/AWS_Events_Invoke_Targets"]
    }
  }

  environment_variables = merge(
    var.global_environment_variables,
    var.conversation_service_environment_variables
  )

  memory_size = var.memory_size
  timeout = var.timeout
}

module "unlucky_service" {
  source = "../../modules/lambda"

  project = var.project
  environment = var.environment
  region = var.default_region
  account_id = var.account_id

  name = "unlucky-service"
  description = "Unlucky Service Lambda Function"

  environment_variables = merge(
    var.global_environment_variables,
    var.unlucky_service_environment_variables
  )

  memory_size = var.memory_size
  timeout = var.timeout
}
