############################################################################
# One VPC per environment. DynamoDB is regional (no VPC attachment needed),
# so the only thing actually living in these subnets is the EB instance(s).
# Still worth a dedicated VPC per env: security groups, NACLs, and any
# future RDS/ElastiCache/VPC endpoints stay scoped to one environment and
# can't accidentally reach another, even within the single AWS account.
############################################################################

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = merge(var.tags, { Name = "loadlead-${var.env}-vpc", Environment = var.env })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(var.tags, { Name = "loadlead-${var.env}-igw", Environment = var.env })
}

resource "aws_subnet" "public" {
  count                   = length(var.azs)
  vpc_id                  = aws_vpc.this.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone       = var.azs[count.index]
  map_public_ip_on_launch = true
  tags = merge(var.tags, {
    Name = "loadlead-${var.env}-public-${var.azs[count.index]}", Environment = var.env, Tier = "public"
  })
}

resource "aws_subnet" "private" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 8)
  availability_zone = var.azs[count.index]
  tags = merge(var.tags, {
    Name = "loadlead-${var.env}-private-${var.azs[count.index]}", Environment = var.env, Tier = "private"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = merge(var.tags, { Name = "loadlead-${var.env}-public-rt", Environment = var.env })
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# ── NAT (staging/prod only — see enable_nat) ───────────────────────────────
resource "aws_eip" "nat" {
  count  = var.enable_nat ? 1 : 0
  domain = "vpc"
  tags   = merge(var.tags, { Name = "loadlead-${var.env}-nat-eip", Environment = var.env })
}

resource "aws_nat_gateway" "this" {
  count         = var.enable_nat ? 1 : 0
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id
  tags          = merge(var.tags, { Name = "loadlead-${var.env}-nat", Environment = var.env })
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id
  dynamic "route" {
    for_each = var.enable_nat ? [1] : []
    content {
      cidr_block     = "0.0.0.0/0"
      nat_gateway_id = aws_nat_gateway.this[0].id
    }
  }
  tags = merge(var.tags, { Name = "loadlead-${var.env}-private-rt", Environment = var.env })
}

resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

resource "aws_security_group" "eb_instance" {
  name        = "loadlead-${var.env}-eb-instance-sg"
  description = "EB instance SG — HTTPS in from CloudFront/ALB only, all egress (DynamoDB/Didit/FMCSA/Resend are all internet APIs)"
  vpc_id      = aws_vpc.this.id

  ingress {
    description = "HTTP from EB load balancer / health checks"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "loadlead-${var.env}-eb-instance-sg", Environment = var.env })
}
