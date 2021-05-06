const { Octokit } = require("@octokit/rest")
const stream = require("stream")
const request = require("request")
const aws = require("aws-sdk")
const Promise = require("bluebird")

const requiredOptions = [
  "githubAccessToken",
  "s3BucketName",
]

module.exports = function(options) {
  requiredOptions.forEach(key => {
    if (!options[key]) {
      console.error("missing option `" + key + "`")
      process.exit(1)
    }
  })

  const github = new Octokit({
    auth: options.githubAccessToken
  })

  function getAllRepos() {
    return new Promise((resolve, reject) => {

      if (options.mode === "organisation") {
        console.log("Running in Organisation mode")
        github.paginate(github.repos.listForOrg, { org: options.organisation, per_page: 100 }).then(handleReposResponse)
      } else {
        // Assume get all repos current user has access to
        console.log("Running in User mode")
        github.repos.getAll({ per_page: 100 }, handleReposResponse)
      }

      function handleReposResponse(res) {
        resolve(res)
      }
    })
  }

  function copyReposToS3(repos) {
    console.log(repos)
    console.log("Found " + repos.length + " repos to backup")
    console.log("-------------------------------------------------")

    const date = new Date().toISOString()
    const s3 = new aws.S3({
      accessKeyId: options.s3AccessKeyId,
      secretAccessKey: options.s3AccessSecretKey
    })

    const uploader = Promise.promisify(s3.upload.bind(s3))
    const tasks = repos.map(repo => {
      const passThroughStream = new stream.PassThrough()
      const arhiveURL =
        "https://api.github.com/repos/" +
        repo.full_name +
        "/tarball/master"
      const requestOptions = {
        url: arhiveURL,
        headers: {
          "User-Agent": "nodejs",
	  "Authorization": "token " + options.githubAccessToken
        }
      }

      request(requestOptions).pipe(passThroughStream)

      const bucketName = options.s3BucketName
      const objectName = date + "/" + repo.full_name + ".tar.gz"
      const params = {
        Bucket: bucketName,
        Key: objectName,
        Body: passThroughStream,
        StorageClass: options.s3StorageClass || "STANDARD",
        ServerSideEncryption: "AES256"
      }

      return uploader(params).then(result => {
        console.log("[✓] " + repo.full_name + ".git - backed up")
      })
    })

    return Promise.all(tasks)
  }

  return getAllRepos().then(copyReposToS3)
}
