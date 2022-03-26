variable project {
  type = string
  description = "Name of Project"
}

variable name {
  type = string
  description = "Lambda Function Service Name"
}

variable environment {
  type = string
  description = "Environment / Stage of Lambda Function"
}

variable region {
  type = string
  description = "AWS Region to deploy to"
  default = "us-east-1"
}

variable account_id {
  type = string
  description = "Id Of AWS Account"
  default = ""
}

variable description {
  type = string
  description = "Description attached to Lambda Function"
}

variable environment_variables {
  type = map(string)
  description = "A map that defines environment variables for the Lambda Function"
  default = {}
}

variable layers {
  type = list(string)
  description = "List of Lambda Layer Version ARNs (maximum of 5) to attach to your Lambda Function"
  default = []
}

variable attach_policy_statements {
  type = bool
  description = "Controls whether policy_statements should be added to IAM role for Lambda Function"
  default = false
}

variable policy_statements {
  type = any
  description = "An additional policy document as JSON to attach to the Lambda Function role"
  default = {}
}

variable memory_size {
  type = number
  description = "Amount of memory in MB your Lambda Function can use at runtime. Valid value between 128 MB to 10,240 MB (10 GB), in 64 MB increments"
}

variable timeout {
  type = number
  description = "The amount of time your Lambda Function has to run in seconds"
}
