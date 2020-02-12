/**

Copyright 2019 Forestry.io Inc

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

*/

import git from 'simple-git/promise'

import * as path from 'path'
import { promises as fs } from 'fs'
import { getGitSSHUrl } from './utils'

export interface CommitOptions {
  files: string[]
  message: string
  name?: string
  email?: string
  push?: boolean
}

export class Repo {
  SSH_KEY_RELATIVE_PATH = '.ssh/id_rsa'

  constructor(
    public pathToRepo: string = process.cwd(),
    public pathToContent: string = ''
  ) {}

  get contentAbsolutePath() {
    return path.join(this.pathToRepo, this.pathToContent)
  }

  get tmpDir() {
    return path.join(this.contentAbsolutePath, '/tmp/')
  }

  get sshKeyPath() {
    return path.join(this.pathToRepo, this.SSH_KEY_RELATIVE_PATH)
  }

  fileAbsolutePath(fileRelativePath: string) {
    return path.join(this.contentAbsolutePath, fileRelativePath)
  }

  async commit(options: CommitOptions) {
    const { files, message, name, email, push } = options
    let flags
    if (options.email) {
      flags = {
        '--author': `"${name || email} <${email}>"`,
      }
    }

    const repo = this.open()
    const branchName = await repo.revparse(['--abbrev-ref', 'HEAD'])

    await repo.add(files)
    const commitResult = await repo.commit(message, files, flags)
    // @ts-ignore The types are incorrect for push
    return push ? await repo.push(['-u', 'origin', branchName]) : commitResult
  }

  push() {
    return this.open().push()
  }

  reset(files: string[]) {
    // TODO: I feel like this in wrong. Taking a list of files and then only resetting the first one?
    return this.open().checkout(files[0])
  }

  getFileAtHead(fileRelativePath: string) {
    try {
      return this.open().show([`HEAD:${fileRelativePath}`])
    } catch (e) {
      return fs.readFile(path.join(this.pathToRepo, fileRelativePath), {
        encoding: 'utf8',
      })
    }
  }

  async getOrigin() {
    const repo = this.open()
    const remotes = await repo.getRemotes(true)
    const originRemotes = remotes.filter((r: any) => r.name == 'origin')

    if (!originRemotes.length) {
      console.warn('No origin remote on the given repo')
      return
    }

    return originRemotes[0].refs.push
  }

  async updateOrigin(remote: string) {
    const repo = await this.open()
    const newRemote = getGitSSHUrl(remote)

    const existingRemotes = await repo.getRemotes(true)
    if (existingRemotes.filter((r: any) => r.name == 'origin').length) {
      console.warn(`Changing remote origin to ${newRemote}`)
    }

    await repo.removeRemote('origin')
    await repo.addRemote('origin', newRemote)
  }

  async createSSHKey(sshKey: string) {
    const parentDir = path.dirname(this.sshKeyPath)
    await fs.mkdir(parentDir, { recursive: true })
    await fs.writeFile(this.sshKeyPath, atob(sshKey), {
      encoding: 'utf8',
      mode: 0o600,
    })
  }

  open() {
    const repo = git(this.pathToRepo)

    let options = [
      '-o UserKnownHostsFile=/dev/null',
      '-o StrictHostKeyChecking=no',
    ]

    try {
      fs.stat(this.sshKeyPath)
      options = [
        ...options,
        '-o IdentitiesOnly=yes',
        `-i ${this.sshKeyPath}`,
        '-F /dev/null',
      ]
    } catch {
      console.warn('No SSH key set.')
    }

    /**
     * This is here to allow committing from the cloud
     *
     * `repo.env` overwrites the environment. Adding `...process.env`
     *  is required for accessing global config values. (i.e. user.name, user.email)
     */

    repo.env({
      GIT_COMMITTER_EMAIL: 'tina@tinacms.org',
      GIT_COMMITTER_NAME: 'TinaCMS',
      ...process.env,
      GIT_SSH_COMMAND: `ssh ${options.join(' ')}`,
    })

    return repo
  }
}