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
    console.log(chalk.yellow('\n📋 Docker Installation:'));
    console.log('\n  Download Docker Desktop:');
    console.log('    https://www.docker.com/products/docker-desktop/');
  }

  private showDockerComposeInstructions(): void {
    console.log(chalk.yellow('\n📋 Docker Compose is included with Docker Desktop.'));
    console.log('If you installed Docker but don\'t have compose, reinstall Docker Desktop:');
    console.log('   https://www.docker.com/products/docker-desktop/');
  }

  private showDockerStartInstructions(): void {
    console.log(chalk.yellow('\n📋 Start Docker:'));
    console.log('   Open the Docker Desktop application');
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
