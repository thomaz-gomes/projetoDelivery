param(
  [string]$DumpPath = ""
)

$containerName = "deliverywl-dev-db"
$volumeName = "deliverywl_dev_db_data"
$image = "postgres:17"
$dbUser = "dev"
$dbPassword = "dev"
$dbName = "delivery_dev"
$hostPort = 5433

Write-Output "Removing existing container (if any)..."
if (docker ps -a --format '{{.Names}}' | Select-String -Pattern "^$containerName$") {
  docker rm -f $containerName | Out-Null
}

Write-Output "Creating persistent volume (if missing)..."
docker volume create $volumeName | Out-Null

Write-Output "Starting Postgres container..."
docker run -d --name $containerName -e POSTGRES_USER=$dbUser -e POSTGRES_PASSWORD=$dbPassword -e POSTGRES_DB=$dbName -v "$($volumeName):/var/lib/postgresql/data" -p "$($hostPort):5432" $image | Out-Null

Write-Output "Waiting for Postgres to accept connections..."
while (-not (docker exec $containerName pg_isready -U $dbUser 2>$null)) {
  Start-Sleep -Seconds 1
}

if ($DumpPath -and (Test-Path $DumpPath)) {
  $basename = Split-Path $DumpPath -Leaf
  Write-Output "Copying dump into container..."
  docker cp $DumpPath "$($containerName):/tmp/$basename"
  if ($basename -like "*.sql") {
    docker exec -i $containerName psql -U $dbUser -d $dbName -f "/tmp/$basename"
  } else {
    docker exec -i $containerName pg_restore -U $dbUser -d $dbName "/tmp/$basename" | Out-Null
  }
  docker exec $containerName rm -f "/tmp/$basename" | Out-Null
}

Write-Output "Dev DB is available at: postgres://$($dbUser):$($dbPassword)@127.0.0.1:$($hostPort)/$($dbName)"