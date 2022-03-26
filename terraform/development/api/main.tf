# API Terraform Config
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

variable domain_name {
  type = string
  description = "Domain Name for the Project"
}

# Local Variables
locals {
  conversation_service_lambda_name = "${var.project}-conversation-service-${var.environment}"
}

# Data Sources
data "aws_lambda_function" "conversation_service_lambda" {
  function_name = local.conversation_service_lambda_name
}

# Domain Name SSL Certificate
resource "aws_acm_certificate" "cert" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  tags = {
    Project = var.project,
    Environment = var.environment
  }
}

resource "aws_route53_zone" "zone" {
  name = var.domain_name
}

resource "aws_route53_record" "verification_records" {
  for_each = {
    for dvo in aws_acm_certificate.cert.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = aws_route53_zone.zone.zone_id
}

resource "aws_acm_certificate_validation" "domain_validation" {
  certificate_arn         = aws_acm_certificate.cert.arn
  validation_record_fqdns = [for record in aws_route53_record.verification_records : record.fqdn]
}

# API Gateway
module "api_gateway" {
  source = "terraform-aws-modules/apigateway-v2/aws"

  name          = "${var.project}-api-gateway-${var.environment}"
  description   = "HTTP API Gateway exposed to Twilio"
  protocol_type = "HTTP"

  domain_name   = var.domain_name
  domain_name_certificate_arn = aws_acm_certificate.cert.arn

  cors_configuration = {
    allow_headers = ["content-type", "x-amz-date", "authorization", "x-api-key", "x-amz-security-token", "x-amz-user-agent"]
    allow_methods = ["*"]
    allow_origins = ["*"]
  }

  # Routes and integrations
  integrations = {
    "POST /sms" = {
      lambda_arn             = data.aws_lambda_function.conversation_service_lambda.arn
      payload_format_version = "2.0"
      timeout_milliseconds   = 20000
    }
  }

  tags = {
    Project = var.project,
    Environment = var.environment,
    Name = "api-gateway"
  }
}

resource "aws_lambda_permission" "lambda_permission" {
  statement_id  = "AllowConversationAPIInvoke"
  action        = "lambda:InvokeFunction"
  function_name = local.conversation_service_lambda_name
  principal     = "apigateway.amazonaws.com"

  # The /*/*/* part allows invocation from any stage, method and resource path
  # within API Gateway REST API.
  source_arn = "${module.api_gateway.apigatewayv2_api_execution_arn}/*/*/*"
}

resource "aws_route53_record" "APIGatewayMapping" {
  name    = var.domain_name
  type    = "A"
  zone_id = aws_route53_zone.zone.zone_id

  alias {
    name                   = module.api_gateway.apigatewayv2_domain_name_target_domain_name
    zone_id                = module.api_gateway.apigatewayv2_domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}