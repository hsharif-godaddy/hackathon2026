import { execa } from 'execa';
import chalk from 'chalk';

export interface DependencyCheckResult {
  name: string;
  installed: boolean;
  version?: string;
  error?: string;
}

export class DependencyChecker {
  private results: DependencyCheckResult[] = [];

  async checkDocker(): Promise<DependencyCheckResult> {
    console.log(chalk.blue('🔍 Checking Docker installation...'));
    
    try {
      const { stdout: version } = await execa('docker', ['--version']);
      const result: DependencyCheckResult = {
        name: 'Docker',
        installed: true,
        version: version.replace('Docker version ', '').split(',')[0]
      };
      
      console.log(chalk.green(`✅ Docker ${result.version} is installed`));
      this.results.push(result);
      return result;
    } catch (error) {
      const result: DependencyCheckResult = {
        name: 'Docker',
        installed: false,
        error: 'Docker is not installed or not in PATH'
      };
      
      console.log(chalk.red('❌ Docker is not installed'));
      this.showDockerInstallInstructions();
      this.results.push(result);
      return result;
    }
  }

  async checkDockerCompose(): Promise<DependencyCheckResult> {
    console.log(chalk.blue('🔍 Checking Docker Compose...'));
    
    try {
      const { stdout: version } = await execa('docker', ['compose', 'version']);
      const result: DependencyCheckResult = {
        name: 'Docker Compose',
        installed: true,
        version: version.split(' ')[3] || 'unknown'
      };
      
      console.log(chalk.green(`✅ Docker Compose ${result.version} is available`));
      this.results.push(result);
      return result;
    } catch (error) {
      const result: DependencyCheckResult = {
        name: 'Docker Compose',
        installed: false,
        error: 'Docker Compose command not available'
      };
      
      console.log(chalk.red('❌ Docker Compose is not available'));
      this.showDockerComposeInstructions();
      this.results.push(result);
      return result;
    }
  }

  async checkDockerRunning(): Promise<DependencyCheckResult> {
    console.log(chalk.blue('🔍 Checking if Docker daemon is running...'));
    
    try {
      await execa('docker', ['info']);
      const result: DependencyCheckResult = {
        name: 'Docker Daemon',
        installed: true,
        version: 'running'
      };
      
      console.log(chalk.green('✅ Docker daemon is running'));
      this.results.push(result);
      return result;
    } catch (error) {
      const result: DependencyCheckResult = {
        name: 'Docker Daemon',
        installed: false,
        error: 'Docker daemon is not running'
      };
      
      console.log(chalk.red('❌ Docker daemon is not running'));
      this.showDockerStartInstructions();
      this.results.push(result);
      return result;
    }
  }

  private showDockerInstallInstructions(): void {
    console.log(chalk.yellow('\n📋 Docker Installation Instructions for Ubuntu:'));
    console.log('\n1. Update package index:');
    console.log('   sudo apt update');
    console.log('\n2. Install prerequisites:');
    console.log('   sudo apt install apt-transport-https ca-certificates curl software-properties-common');
    console.log('\n3. Add Docker GPG key:');
    console.log('   curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg');
    console.log('\n4. Add Docker repository:');
    console.log('   echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null');
    console.log('\n5. Install Docker:');
    console.log('   sudo apt update && sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin');
    console.log('\n6. Add user to docker group (optional, to run without sudo):');
    console.log('   sudo usermod -aG docker $USER');
    console.log('   newgrp docker');
  }

  private showDockerComposeInstructions(): void {
    console.log(chalk.yellow('\n📋 Docker Compose is usually included with Docker Desktop or docker-ce-cli.'));
    console.log('If you installed Docker but don\'t have compose, try:');
    console.log('   sudo apt install docker-compose-plugin');
  }

  private showDockerStartInstructions(): void {
    console.log(chalk.yellow('\n📋 Start Docker daemon:'));
    console.log('   sudo systemctl start docker');
    console.log('   sudo systemctl enable docker  # Start on boot');
  }

  async checkAllDockerDependencies(): Promise<boolean> {
    console.log(chalk.cyan('\n🚀 Checking Docker dependencies...\n'));
    
    const dockerResult = await this.checkDocker();
    const composeResult = await this.checkDockerCompose();
    const daemonResult = await this.checkDockerRunning();
    
    const allGood = dockerResult.installed && composeResult.installed && daemonResult.installed;
    
    console.log(chalk.cyan('\n📊 Docker Dependencies Summary:'));
    console.log(`Docker: ${dockerResult.installed ? chalk.green('✅') : chalk.red('❌')}`);
    console.log(`Docker Compose: ${composeResult.installed ? chalk.green('✅') : chalk.red('❌')}`);
    console.log(`Docker Running: ${daemonResult.installed ? chalk.green('✅') : chalk.red('❌')}`);
    
    return allGood;
  }

  getResults(): DependencyCheckResult[] {
    return this.results;
  }
}