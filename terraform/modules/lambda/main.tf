module "lambda_function" {
  source = "terraform-aws-modules/lambda/aws"
  version = "~>2.34.0"

  function_name = "${var.project}-${var.name}-${var.environment}"
  description   = try(var.description, "")
  handler       = "index.main"
  runtime       = "nodejs14.x"

  source_path = "../../../dist/${replace(var.name, "-service", "" )}"
  environment_variables = try(
    merge(
      var.environment_variables,
      {
        ENVIRONMENT = var.environment
      }
    ),
  {
    ENVIRONMENT = var.environment,
    PROJECT = var.project,
    NAME = var.name,
    FULL_NAME = "${var.project}-${var.name}-${var.environment}",
    AWS_REGION = var.region
  })
  layers = try(var.layers, null)

  attach_policy_statements = var.attach_policy_statements
  policy_statements = merge(
    var.policy_statements,
    {
      create_logs = {
        effect = "Allow"
        actions = ["logs:CreateLogStream", "logs:CreateLogGroup"]
        resources = [
          "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${var.project}-${var.name}-${var.environment}:*",
        ]
      },
      insert_logs = {
        effect = "Allow"
        actions = ["logs:PutLogEvents"]
        resources = [
          "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${var.project}-${var.name}-${var.environment}:*:*",
        ]
      }
    }
  )

  memory_size = var.memory_size
  timeout = var.timeout

  tags = {
    Project = var.project,
    Environment = var.environment,
    Name = var.name
  }
}
