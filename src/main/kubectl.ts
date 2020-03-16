import { app, remote } from "electron"
import * as path from "path"
import * as fs from "fs"
import * as request from "request"
import * as requestPromise from "request-promise-native"
import logger from "./logger"
import { ensureDir, pathExists } from "fs-extra"
import * as md5File from "md5-file"
import { globalRequestOpts } from "../common/request"
import * as lockFile from "proper-lockfile"
import { helmCli } from "./helm-cli"

const kubectlMap: Map<string, string> = new Map([
  ["1.7", "1.8.15"],
  ["1.8", "1.9.10"],
  ["1.9", "1.10.13"],
  ["1.10", "1.11.10"],
  ["1.11", "1.12.10"],
  ["1.12", "1.13.12"],
  ["1.13", "1.13.12"],
  ["1.14", "1.14.10"],
  ["1.15", "1.15.10"],
  ["1.16", "1.16.7"],
  ["1.17", "1.17.3"],
  ["1.18", "1.18.0-beta.1"]
])

const initScriptVersionString = "# lens-initscript v3\n"

const isDevelopment = process.env.NODE_ENV !== "production"
let bundledPath: string = null

if(isDevelopment) {
  bundledPath = path.join(process.cwd(), "binaries", "client", process.platform, process.arch, "kubectl")
} else {
  bundledPath = path.join(process.resourcesPath, process.arch, "kubectl")
}

if(process.platform === "win32") bundledPath = `${bundledPath}.exe`

export class Kubectl {

  public kubectlVersion: string
  protected directory: string
  protected url: string
  protected path: string
  protected dirname: string

  public static readonly kubectlDir = path.join((app || remote.app).getPath("userData"), "binaries", "kubectl")
  public static readonly bundledKubectlPath = bundledPath
  public static readonly bundledKubectlVersion: string = require("../../package.json").config.bundledKubectlVersion
  private static bundledInstance: Kubectl;

  // Returns the single bundled Kubectl instance
  public static bundled() {
    if(!Kubectl.bundledInstance) Kubectl.bundledInstance = new Kubectl(Kubectl.bundledKubectlVersion)
    return Kubectl.bundledInstance
  }

  constructor(clusterVersion: string) {
    const versionParts = /^v?(\d+\.\d+)(.*)/.exec(clusterVersion)
    const minorVersion = versionParts[1]
    /* minorVersion is the first two digits of kube server version
       if the version map includes that, use that version, if not, fallback to the exact x.y.z of kube version */
    if(kubectlMap.has(minorVersion)) {
      this.kubectlVersion = kubectlMap.get(minorVersion)
      logger.debug("Set kubectl version " + this.kubectlVersion + " for cluster version " + clusterVersion + " using version map")
    } else {
      this.kubectlVersion = versionParts[1] + versionParts[2]
      logger.debug("Set kubectl version " + this.kubectlVersion + " for cluster version " + clusterVersion + " using fallback")
    }

    let arch = null

    if(process.arch == "x64") {
      arch = "amd64"
    } else if(process.arch == "x86" || process.arch == "ia32") {
      arch = "386"
    } else {
      arch = process.arch
    }

    const platformName = process.platform === "win32" ? "windows" : process.platform
    const binaryName = process.platform === "win32" ? "kubectl.exe" : "kubectl"

    this.url = `https://storage.googleapis.com/kubernetes-release/release/v${this.kubectlVersion}/bin/${platformName}/${arch}/${binaryName}`

    this.dirname = path.normalize(path.join(Kubectl.kubectlDir, this.kubectlVersion))
    this.path = path.join(this.dirname, binaryName)
  }

  public async kubectlPath(): Promise<string> {
    try {
      await this.ensureKubectl()
      return this.path
    } catch(err) {
      logger.error("Failed to ensure kubectl, fallback to the bundled version")
      logger.error(err)
      return Kubectl.bundledKubectlPath
    }
  }

  public async binDir() {
    try {
      await this.ensureKubectl()
      return this.dirname
    } catch(err) {
      logger.error(err)
      return ""
    }
  }

  protected async urlEtag() {
    const response = await requestPromise({
      method: "HEAD",
      uri: this.url,
      resolveWithFullResponse: true,
      timeout: 4000,
      ...this.getRequestOpts()
    }).catch((error) => { logger.error(error) })

    if (response && response.headers["etag"]) {
      return response.headers["etag"].replace(/"/g, "")
    }
    return ""
  }

  public async checkBinary(checkTag = true) {
    const exists = await pathExists(this.path)
    if (exists) {
      if (!checkTag) {
        return true
      }
      const hash = md5File.sync(this.path)
      const etag = await this.urlEtag()
      if (etag === "") {
        logger.debug("Cannot resolve kubectl remote etag")
        return true
      }
      if (hash == etag) {
        logger.debug("Kubectl md5sum matches the remote etag")
        return true
      }

      logger.error("Kubectl md5sum " + hash + " does not match the remote etag " + etag + ", unlinking and downloading again")
      await fs.promises.unlink(this.path)
    }

    return false
  }

  protected async checkBundled(): Promise<boolean> {
    if(this.kubectlVersion === Kubectl.bundledKubectlVersion) {
      try {
        const exist = await pathExists(this.path)
        if (!exist) {
          await fs.promises.copyFile(Kubectl.bundledKubectlPath, this.path)
          await fs.promises.chmod(this.path, 0o755)
        }
        return true
      } catch(err) {
        logger.error("Could not copy the bundled kubectl to app-data: " + err)
        return false
      }
    } else {
      return false
    }
  }

  protected async ensureKubectl(): Promise<boolean> {
    await ensureDir(this.dirname, 0o755)
    return lockFile.lock(this.dirname).then(async (release) => {
      logger.debug(`Acquired a lock for ${this.kubectlVersion}`)
      const bundled = await this.checkBundled()
      const isValid = await this.checkBinary(!bundled)
      if(!isValid) {
        await this.downloadKubectl().catch((error) => { logger.error(error) });
      }
      await this.writeInitScripts().catch((error) => { logger.error("Failed to write init scripts"); logger.error(error) })
      logger.debug(`Releasing lock for ${this.kubectlVersion}`)
      release()
      return true
    }).catch((e) => {
      logger.error(`Failed to get a lock for ${this.kubectlVersion}`)
      logger.error(e)
      return false
    })
  }

  public async downloadKubectl() {
    await ensureDir(path.dirname(this.path), 0o755)

    logger.info(`Downloading kubectl ${this.kubectlVersion} from ${this.url} to ${this.path}`)
    return new Promise((resolve, reject) => {
      const stream = request({
        gzip: true,
        ...this.getRequestOpts()
      })
      const file = fs.createWriteStream(this.path)
      stream.on("complete", () => {
        logger.debug("kubectl binary download finished")
        file.end(() => {})
      })
      stream.on("error", (error) => {
        logger.error(error)
        fs.unlink(this.path, () => {})
        reject(error)
      })
      file.on("close", () => {
        logger.debug("kubectl binary download closed")
        fs.chmod(this.path, 0o755, () => {})
        resolve()
      })
      stream.pipe(file)
    })
  }

  protected async scriptIsLatest(scriptPath: string) {
    const scriptExists = await pathExists(scriptPath)
    if(!scriptExists) return false

    try {
      const filehandle = await fs.promises.open(scriptPath, 'r')
      const buffer = Buffer.alloc(40)
      await filehandle.read(buffer, 0, 40, 0)
      await filehandle.close()
      return buffer.toString().startsWith(initScriptVersionString)
    } catch (err) {
      logger.error(err)
      return false
    }
  }

  protected async writeInitScripts() {
    const helmPath = helmCli.getBinaryDir()
    const fsPromises = fs.promises;
    const bashScriptPath = path.join(this.dirname, '.bash_set_path')
    const bashScriptIsLatest = await this.scriptIsLatest(bashScriptPath)
    if(!bashScriptIsLatest) {
      let bashScript = "" + initScriptVersionString
      bashScript += "tempkubeconfig=\"$KUBECONFIG\"\n"
      bashScript += "test -f \"/etc/profile\" && . \"/etc/profile\"\n"
      bashScript += "if test -f \"$HOME/.bash_profile\"; then\n"
      bashScript += "  . \"$HOME/.bash_profile\"\n"
      bashScript += "elif test -f \"$HOME/.bash_login\"; then\n"
      bashScript += "  . \"$HOME/.bash_login\"\n"
      bashScript += "elif test -f \"$HOME/.profile\"; then\n"
      bashScript += "  . \"$HOME/.profile\"\n"
      bashScript += "fi\n"
      bashScript += `export PATH="${this.dirname}:${helmPath}:$PATH"\n`
      bashScript += "export KUBECONFIG=\"$tempkubeconfig\"\n"
      bashScript += "unset tempkubeconfig\n"
      await fsPromises.writeFile(bashScriptPath, bashScript.toString(), { mode: 0o644 })
    }

    const zshScriptPath = path.join(this.dirname, '.zlogin')
    const zshScriptIsLatest = await this.scriptIsLatest(zshScriptPath)
    if(!zshScriptIsLatest) {
      let zshScript = "" + initScriptVersionString

      zshScript += "tempkubeconfig=\"$KUBECONFIG\"\n"
      // restore previous ZDOTDIR
      zshScript += "export ZDOTDIR=\"$OLD_ZDOTDIR\"\n"
      // source all the files
      zshScript += "test -f \"$OLD_ZDOTDIR/.zshenv\" && . \"$OLD_ZDOTDIR/.zshenv\"\n"
      zshScript += "test -f \"$OLD_ZDOTDIR/.zprofile\" && . \"$OLD_ZDOTDIR/.zprofile\"\n"
      zshScript += "test -f \"$OLD_ZDOTDIR/.zlogin\" && . \"$OLD_ZDOTDIR/.zlogin\"\n"
      zshScript += "test -f \"$OLD_ZDOTDIR/.zshrc\" && . \"$OLD_ZDOTDIR/.zshrc\"\n"

      // voodoo to replace any previous occurences of kubectl path in the PATH
      zshScript += `kubectlpath=\"${this.dirname}"\n`
      zshScript += `helmpath=\"${helmPath}"\n`
      zshScript += "p=\":$kubectlpath:\"\n"
      zshScript += "d=\":$PATH:\"\n"
      zshScript += "d=${d//$p/:}\n"
      zshScript += "d=${d/#:/}\n"
      zshScript += "export PATH=\"$kubectlpath:$helmpath:${d/%:/}\"\n"
      zshScript += "export KUBECONFIG=\"$tempkubeconfig\"\n"
      zshScript += "unset tempkubeconfig\n"
      zshScript += "unset OLD_ZDOTDIR\n"
      await fsPromises.writeFile(zshScriptPath, zshScript.toString(), { mode: 0o644 })
    }
  }

  protected getRequestOpts() {
    return globalRequestOpts({
      url: this.url
    })
  }
}

const bundledKubectl = Kubectl.bundled()
export { bundledKubectl }
