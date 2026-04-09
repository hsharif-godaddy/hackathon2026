import chalk from 'chalk';
import inquirer from 'inquirer';
import path from 'path';
import fs from 'fs-extra';
import { execa } from 'execa';

export class CASetup {
  private projectRoot: string;
  private caDir: string;
  private caCertPath: string;
  private caKeyPath: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.caDir = path.join(projectRoot, '.dev-ca');
    this.caCertPath = path.join(this.caDir, 'ca-cert.pem');
    this.caKeyPath = path.join(this.caDir, 'ca-key.pem');
  }

  async setup(yesToAll: boolean = false): Promise<void> {
    console.log(chalk.cyan('🔒 Development Certificate Authority Setup'));
    console.log('');

    if (await this.caExists()) {
      console.log(chalk.green('✅ CA already exists at:'), this.caCertPath);

      const isTrusted = await this.isCAAlreadyTrusted();
      if (isTrusted) {
        console.log(chalk.green('✅ CA is already trusted in system'));
      }
      console.log('');

      if (yesToAll) {
        console.log(chalk.gray('Automated mode: skipping CA setup...'));
        console.log('');
        return;
      }

      const choices = [
        { name: 'Trust the existing CA', value: 'trust' },
        { name: 'Regenerate CA (will require re-trusting)', value: 'regenerate' },
        { name: 'Skip', value: 'skip' }
      ];

      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'What would you like to do?',
          choices,
          default: isTrusted ? 'skip' : 'trust'
        }
      ]);

      if (action === 'skip') {
        return;
      } else if (action === 'trust') {
        await this.trustCA(false);
        return;
      } else if (action === 'regenerate') {
        await this.generateCA();
        await this.trustCA(false);
        return;
      }
    }

    await this.generateCA();
    await this.trustCA(yesToAll);
  }

  private async caExists(): Promise<boolean> {
    return (
      (await fs.pathExists(this.caCertPath)) &&
      (await fs.pathExists(this.caKeyPath))
    );
  }

  private async isCAAlreadyTrusted(): Promise<boolean> {
    const platform = process.platform;

    try {
      if (platform === 'darwin') {
        const { stdout } = await execa('security', [
          'find-certificate',
          '-c',
          'Airo Builder Development CA',
          '-a',
          '-Z',
          '/Library/Keychains/System.keychain'
        ]);

        if (!stdout.includes('Airo Builder Development CA')) {
          return false;
        }

        const sha1Match = stdout.match(/SHA-1 hash:\s*([A-Fa-f0-9]+)/);
        if (!sha1Match) {
          return false;
        }

        try {
          await execa('security', [
            'verify-cert',
            '-c',
            this.caCertPath
          ]);
          return true;
        } catch {
          return false;
        }
      } else if (platform === 'linux') {
        return await fs.pathExists('/usr/local/share/ca-certificates/airo-dev-ca.crt');
      }
    } catch {
      return false;
    }

    return false;
  }

  private async generateCA(): Promise<void> {
    console.log(chalk.blue('📋 Generating Certificate Authority...'));
    console.log('');

    try {
      const appPackagePath = path.join(this.projectRoot, 'app');

      await execa(
        'node',
        [
          '-e',
          `
          const path = require('path');
          const forge = require('node-forge');
          const fs = require('fs');

          const caDir = path.join('${this.caDir}');
          const certPath = path.join(caDir, 'ca-cert.pem');
          const keyPath = path.join(caDir, 'ca-key.pem');

          if (!fs.existsSync(caDir)) {
            fs.mkdirSync(caDir, { recursive: true });
          }

          const keys = forge.pki.rsa.generateKeyPair(2048);
          const cert = forge.pki.createCertificate();

          cert.publicKey = keys.publicKey;
          cert.serialNumber = '01';
          cert.validity.notBefore = new Date();
          cert.validity.notAfter = new Date();
          cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

          const attrs = [
            { name: 'commonName', value: 'Airo Builder Development CA' },
            { name: 'organizationName', value: 'Airo Development' },
            { name: 'organizationalUnitName', value: 'Development' }
          ];

          cert.setSubject(attrs);
          cert.setIssuer(attrs);

          cert.setExtensions([
            { name: 'basicConstraints', cA: true, critical: true },
            { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
            { name: 'subjectKeyIdentifier' }
          ]);

          cert.sign(keys.privateKey, forge.md.sha256.create());

          fs.writeFileSync(certPath, forge.pki.certificateToPem(cert));
          fs.writeFileSync(keyPath, forge.pki.privateKeyToPem(keys.privateKey));

          console.log('CA generated successfully');
        `
        ],
        { cwd: appPackagePath }
      );

      console.log(chalk.green('✅ CA certificate generated successfully'));
      console.log(chalk.gray(`   Location: ${this.caCertPath}`));
      console.log('');
    } catch (error) {
      console.log(chalk.red('❌ Failed to generate CA certificate'));
      throw error;
    }
  }

  private async trustCA(yesToAll: boolean = false): Promise<void> {
    let shouldTrust = yesToAll;

    if (!yesToAll) {
      const response = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'shouldTrust',
          message: 'Would you like to trust the CA certificate now?',
          default: true
        }
      ]);
      shouldTrust = response.shouldTrust;
    } else {
      console.log(chalk.gray('Automated mode: trusting CA certificate...'));
    }

    if (!shouldTrust) {
      console.log('');
      console.log(chalk.yellow('⚠️  CA certificate not trusted.'));
      console.log(chalk.gray('   You can trust it later by running: ./scripts/trust-dev-ca.sh'));
      console.log('');
      return;
    }

    console.log('');
    await this.installCAToSystem(yesToAll);
  }

  private async installCAToSystem(yesToAll: boolean = false): Promise<void> {
    const platform = process.platform;

    if (platform === 'linux') {
      await this.installCALinux(yesToAll);
    } else if (platform === 'darwin') {
      await this.installCAMacOS();
    } else {
      console.log(chalk.yellow('⚠️  Automatic CA installation not supported on this platform'));
      console.log('');
      console.log('Please manually import the CA certificate:');
      console.log(chalk.blue(`  ${this.caCertPath}`));
      console.log('');
      console.log('Import it into your browser/system trust store.');
    }
  }

  private async installCALinux(yesToAll: boolean = false): Promise<void> {
    console.log(chalk.blue('📋 Installing CA to Linux/WSL2 system trust store...'));
    console.log('');

    try {
      await execa('sudo', [
        'cp',
        this.caCertPath,
        '/usr/local/share/ca-certificates/airo-dev-ca.crt'
      ]);

      await execa('sudo', ['update-ca-certificates']);

      console.log(chalk.green('✅ CA certificate installed to system trust store'));
      console.log('');

      const isWSL = await this.isWSL2();
      if (isWSL) {
        await this.installCAWindowsHost(yesToAll);
      }

      console.log(chalk.yellow('⚠️  Browser-specific trust:'));
      console.log('');
      console.log(chalk.gray('Chrome/Chromium:'));
      console.log(chalk.gray('  1. Open chrome://settings/certificates'));
      console.log(chalk.gray('  2. Go to "Authorities" tab'));
      console.log(chalk.gray('  3. Click "Import" and select:'), this.caCertPath);
      console.log(chalk.gray('  4. Check "Trust this certificate for identifying websites"'));
      console.log('');
      console.log(chalk.gray('Firefox:'));
      console.log(chalk.gray('  1. Open about:preferences#privacy'));
      console.log(chalk.gray('  2. Scroll to "Certificates" and click "View Certificates"'));
      console.log(chalk.gray('  3. Go to "Authorities" tab'));
      console.log(chalk.gray('  4. Click "Import" and select:'), this.caCertPath);
      console.log(chalk.gray('  5. Check "Trust this CA to identify websites"'));
      console.log('');
    } catch (error) {
      console.log(chalk.red('❌ Failed to install CA certificate'));
      console.log('');
      console.log('You can install it manually:');
      console.log(chalk.blue(`  sudo cp ${this.caCertPath} /usr/local/share/ca-certificates/airo-dev-ca.crt`));
      console.log(chalk.blue('  sudo update-ca-certificates'));
      console.log('');
    }
  }

  private async installCAMacOS(): Promise<void> {
    console.log(chalk.blue('📋 Installing CA to macOS system keychain...'));
    console.log('');

    try {
      await execa('sudo', [
        'security',
        'add-trusted-cert',
        '-d',
        '-r',
        'trustRoot',
        '-k',
        '/Library/Keychains/System.keychain',
        this.caCertPath
      ]);

      console.log(chalk.green('✅ CA certificate installed to system keychain'));
      console.log('');
      console.log(chalk.yellow('⚠️  Chrome users:'));
      console.log(chalk.gray('Chrome may not read the macOS keychain. If preview still fails, manually import the CA:'));
      console.log(chalk.gray('  1. Go to chrome://certificate-manager/localcerts/usercerts'));
      console.log(chalk.gray('  2. Click "Import" on Trust Certificates'));
      console.log(chalk.gray('  3. Select:'), this.caCertPath);
      console.log(chalk.gray('     (press Cmd+Shift+. in the file picker to show hidden directories)'));
      console.log('');
      console.log(chalk.yellow('⚠️  Firefox users:'));
      console.log(chalk.gray('Firefox uses its own trust store. You need to:'));
      console.log(chalk.gray('  1. Open about:preferences#privacy'));
      console.log(chalk.gray('  2. Scroll to "Certificates" and click "View Certificates"'));
      console.log(chalk.gray('  3. Go to "Authorities" tab'));
      console.log(chalk.gray('  4. Click "Import" and select:'), this.caCertPath);
      console.log(chalk.gray('  5. Check "Trust this CA to identify websites"'));
      console.log('');
    } catch (error) {
      console.log(chalk.red('❌ Failed to install CA certificate'));
      console.log('');
      console.log('You can install it manually:');
      console.log(
        chalk.blue(
          `  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ${this.caCertPath}`
        )
      );
      console.log('');
    }
  }

  async checkStatus(): Promise<void> {
    console.log(chalk.blue('🔒 Development CA Status:'));

    if (await this.caExists()) {
      console.log(chalk.green('  ✅ CA certificate exists'));
      console.log(chalk.gray(`     ${this.caCertPath}`));
    } else {
      console.log(chalk.red('  ❌ CA certificate not found'));
      console.log(chalk.gray('     Run setup to generate it'));
    }
  }

  private async isWSL2(): Promise<boolean> {
    try {
      await fs.access('/mnt/c');
      return true;
    } catch {
      return false;
    }
  }

  private async installCAWindowsHost(yesToAll: boolean = false): Promise<void> {
    console.log('');
    console.log(chalk.blue('📋 Detected WSL2 - Windows host certificate installation available'));
    console.log('');

    try {
      await execa('powershell.exe', ['-Command', 'exit 0']);
    } catch {
      console.log(chalk.yellow('⚠️  PowerShell not available, skipping Windows host installation'));
      return;
    }

    let shouldInstallWindows = yesToAll;

    if (!yesToAll) {
      const response = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'shouldInstallWindows',
          message: 'Install CA to Windows host as well? (Recommended for Windows browsers)',
          default: true
        }
      ]);
      shouldInstallWindows = response.shouldInstallWindows;
    } else {
      console.log(chalk.gray('Automated mode: installing to Windows host...'));
    }

    if (!shouldInstallWindows) {
      console.log('');
      console.log(chalk.yellow('⚠️  Skipping Windows host installation'));
      console.log(chalk.gray('   You can install it later manually (see trust-dev-ca.sh)'));
      console.log('');
      return;
    }

    console.log('');
    console.log(chalk.blue('🔐 Installing CA to Windows host certificate store...'));
    console.log(chalk.gray('   This requires administrator privileges on Windows'));
    console.log('');

    try {
      let windowsPath: string;
      try {
        const { stdout } = await execa('wslpath', ['-w', this.caCertPath]);
        windowsPath = stdout.trim();
      } catch {
        windowsPath = this.caCertPath.replace(/\/mnt\/([a-z])\//g, '$1:/').replace(/\//g, '\\');
      }

      const psCommand = `Start-Process powershell -Verb RunAs -ArgumentList '-Command', 'Import-Certificate -FilePath \"${windowsPath}\" -CertStoreLocation Cert:\\LocalMachine\\Root'`;

      await execa('powershell.exe', ['-Command', psCommand]);

      console.log(chalk.green('✅ CA certificate installation initiated on Windows host'));
      console.log(chalk.gray('   You may see a UAC prompt - please approve it'));
      console.log('');
    } catch (error) {
      console.log(chalk.red('❌ Failed to install CA certificate on Windows host'));
      console.log('');
      console.log('You can install it manually by running this in an elevated PowerShell:');

      let windowsPath: string;
      try {
        const { stdout } = await execa('wslpath', ['-w', this.caCertPath]);
        windowsPath = stdout.trim();
      } catch {
        windowsPath = this.caCertPath.replace(/\/mnt\/([a-z])\//g, '$1:/').replace(/\//g, '\\');
      }

      console.log(chalk.blue(`  Import-Certificate -FilePath "${windowsPath}" -CertStoreLocation Cert:\\LocalMachine\\Root`));
      console.log('');
    }
  }
}
